import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { getDb } from "@/db";
import { chatAttachments, chatMessages, chatReactions, chatStickers } from "@/db/schema";
import { isUniqueConstraintError } from "@/lib/database-errors";
import { toAttachmentDto, toStickerDto } from "./extras";
import { canPostTopLevel, canReplyInThread, isChatAdmin } from "./permissions";
import { CHAT_MESSAGE_MAX_LENGTH, ChatError, getMessageDto, requireMembership } from "./service";
import type { ChatAttachmentDto, ChatMessageDto, ChatStickerDto, ChatStickerKind } from "./types";

type Db = ReturnType<typeof getDb>;

export const CHAT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const CHAT_STICKER_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_STICKER_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const UNSENT_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;
const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

async function loadMessage(db: Db, messageId: string) {
	const [row] = await db
		.select({
			id: chatMessages.id,
			conversationId: chatMessages.conversationId,
			senderUserId: chatMessages.senderUserId,
			parentMessageId: chatMessages.parentMessageId,
			stickerId: chatMessages.stickerId,
		})
		.from(chatMessages)
		.where(and(eq(chatMessages.id, messageId), isNull(chatMessages.deletedAt)))
		.limit(1);
	if (!row) throw new ChatError("That message is no longer available", 404);
	return row;
}

async function requireMessage(db: Db, messageId: string): Promise<ChatMessageDto> {
	const message = await getMessageDto(db, messageId);
	if (!message) throw new ChatError("That message is no longer available", 404);
	return message;
}

/** Only the sender can edit a message. */
export async function editMessage(db: Db, userId: string, messageId: string, rawBody: unknown): Promise<ChatMessageDto> {
	const row = await loadMessage(db, messageId);
	await requireMembership(db, row.conversationId, userId);
	if (row.senderUserId !== userId) throw new ChatError("You can only edit your own messages", 403);
	const body = typeof rawBody === "string" ? rawBody.replace(/\r\n/g, "\n").trim() : "";
	if (body.length > CHAT_MESSAGE_MAX_LENGTH) throw new ChatError(`Messages can be at most ${CHAT_MESSAGE_MAX_LENGTH} characters`);
	if (!body && !row.stickerId) {
		const [attachment] = await db.select({ id: chatAttachments.id }).from(chatAttachments).where(eq(chatAttachments.messageId, messageId)).limit(1);
		if (!attachment) throw new ChatError("Write a message first");
	}
	await db.update(chatMessages).set({ body, editedAt: Date.now() }).where(eq(chatMessages.id, messageId));
	return requireMessage(db, messageId);
}

/**
 * The sender, or a space's owner/admin, can delete a message. Deleting a thread's top message removes its replies too.
 * Returns what the caller needs to broadcast and the storage keys to delete.
 */
export async function deleteMessage(db: Db, userId: string, messageId: string): Promise<{ conversationId: string; parentMessageId: string | null; keys: string[] }> {
	const row = await loadMessage(db, messageId);
	const membership = await requireMembership(db, row.conversationId, userId);
	const moderator = membership.type === "space" && isChatAdmin(membership.role);
	if (row.senderUserId !== userId && !moderator) throw new ChatError("You can only delete your own messages", 403);

	const replyIds = row.parentMessageId
		? []
		: (await db.select({ id: chatMessages.id }).from(chatMessages).where(eq(chatMessages.parentMessageId, messageId))).map((reply) => reply.id);
	const ids = [messageId, ...replyIds];
	const keys: string[] = [];
	const now = Date.now();
	// Chunks keep each IN list well under D1's bound parameter limit.
	for (let index = 0; index < ids.length; index += 50) {
		const chunk = ids.slice(index, index + 50);
		const attachments = await db.select({ r2Key: chatAttachments.r2Key }).from(chatAttachments).where(inArray(chatAttachments.messageId, chunk));
		keys.push(...attachments.map((attachment) => attachment.r2Key));
		await db.delete(chatAttachments).where(inArray(chatAttachments.messageId, chunk));
		await db.delete(chatReactions).where(inArray(chatReactions.messageId, chunk));
		await db.update(chatMessages).set({ deletedAt: now, body: "", stickerId: null }).where(inArray(chatMessages.id, chunk));
	}
	if (row.parentMessageId) {
		await db
			.update(chatMessages)
			.set({ replyCount: sql`case when ${chatMessages.replyCount} > 0 then ${chatMessages.replyCount} - 1 else 0 end` })
			.where(eq(chatMessages.id, row.parentMessageId));
	}
	return { conversationId: row.conversationId, parentMessageId: row.parentMessageId, keys };
}

/** Adds the reaction, or removes it when this user already reacted with that emoji. */
export async function toggleReaction(db: Db, userId: string, messageId: string, rawEmoji: unknown): Promise<ChatMessageDto> {
	const emoji = typeof rawEmoji === "string" ? rawEmoji.trim() : "";
	if (!emoji || emoji.length > 32 || !EMOJI_PATTERN.test(emoji)) throw new ChatError("Choose an emoji");
	const row = await loadMessage(db, messageId);
	await requireMembership(db, row.conversationId, userId);
	const where = and(eq(chatReactions.messageId, messageId), eq(chatReactions.userId, userId), eq(chatReactions.emoji, emoji));
	const [existing] = await db.select({ id: chatReactions.id }).from(chatReactions).where(where).limit(1);
	if (existing) {
		await db.delete(chatReactions).where(eq(chatReactions.id, existing.id));
	} else {
		try {
			await db.insert(chatReactions).values({ id: crypto.randomUUID(), messageId, userId, emoji, createdAt: Date.now() });
		} catch (error) {
			if (!isUniqueConstraintError(error)) throw error;
		}
	}
	return requireMessage(db, messageId);
}

/** Unsent uploads older than a day are abandoned drafts; drop them so storage doesn't fill up. Returns their keys. */
async function collectAbandonedUploads(db: Db, userId: string): Promise<string[]> {
	const rows = await db
		.select({ id: chatAttachments.id, r2Key: chatAttachments.r2Key })
		.from(chatAttachments)
		.where(and(eq(chatAttachments.uploaderUserId, userId), isNull(chatAttachments.messageId), lt(chatAttachments.createdAt, Date.now() - UNSENT_ATTACHMENT_TTL_MS)))
		.limit(50);
	if (rows.length === 0) return [];
	await db.delete(chatAttachments).where(inArray(chatAttachments.id, rows.map((row) => row.id)));
	return rows.map((row) => row.r2Key);
}

/** Stores an uploaded file as an unsent attachment of the conversation. */
export async function createAttachment(
	env: CloudflareEnv,
	db: Db,
	userId: string,
	conversationId: string,
	file: { name: string; contentType: string; size: number; body: ReadableStream },
): Promise<{ attachment: ChatAttachmentDto; abandonedKeys: string[] }> {
	const membership = await requireMembership(db, conversationId, userId);
	if (!canPostTopLevel(membership.type, membership.postPolicy, membership.role) && !canReplyInThread(membership.type, membership.postPolicy, membership.role)) {
		throw new ChatError("Only admins can post in this space", 403);
	}
	const id = crypto.randomUUID();
	const r2Key = `chat/${conversationId}/${id}`;
	await env.BUCKET.put(r2Key, file.body, { httpMetadata: { contentType: file.contentType } });
	const createdAt = Date.now();
	try {
		await db.insert(chatAttachments).values({ id, conversationId, messageId: null, uploaderUserId: userId, name: file.name, contentType: file.contentType, size: file.size, r2Key, createdAt });
	} catch (error) {
		await env.BUCKET.delete(r2Key).catch(() => undefined);
		throw error;
	}
	return { attachment: toAttachmentDto({ id, name: file.name, size: file.size, contentType: file.contentType }), abandonedKeys: await collectAbandonedUploads(db, userId) };
}

/** An attachment someone may open: sent in a conversation they belong to, or their own unsent upload. */
export async function getAttachmentForUser(db: Db, userId: string, attachmentId: string) {
	const [row] = await db.select().from(chatAttachments).where(eq(chatAttachments.id, attachmentId)).limit(1);
	if (!row) throw new ChatError("Not found", 404);
	await requireMembership(db, row.conversationId, userId);
	if (!row.messageId && row.uploaderUserId !== userId) throw new ChatError("Not found", 404);
	return row;
}

/** Removes an upload the user attached but hasn't sent. Returns its storage key. */
export async function deleteUnsentAttachment(db: Db, userId: string, attachmentId: string): Promise<string> {
	const [row] = await db
		.select({ id: chatAttachments.id, r2Key: chatAttachments.r2Key })
		.from(chatAttachments)
		.where(and(eq(chatAttachments.id, attachmentId), eq(chatAttachments.uploaderUserId, userId), isNull(chatAttachments.messageId)))
		.limit(1);
	if (!row) throw new ChatError("Not found", 404);
	await db.delete(chatAttachments).where(eq(chatAttachments.id, row.id));
	return row.r2Key;
}

export async function listStickers(db: Db): Promise<ChatStickerDto[]> {
	const rows = await db
		.select({ id: chatStickers.id, kind: chatStickers.kind, name: chatStickers.name, createdByUserId: chatStickers.createdByUserId })
		.from(chatStickers)
		.orderBy(desc(chatStickers.createdAt), asc(chatStickers.id))
		.limit(500);
	return rows.map(toStickerDto);
}

/** Adds an image to the installation's shared sticker and GIF library. */
export async function createSticker(
	env: CloudflareEnv,
	db: Db,
	userId: string,
	sticker: { name: string; kind: ChatStickerKind; contentType: string; size: number; body: ReadableStream },
): Promise<ChatStickerDto> {
	if (!CHAT_STICKER_TYPES.has(sticker.contentType)) throw new ChatError("Use a PNG, JPEG, GIF or WebP image");
	const id = crypto.randomUUID();
	const r2Key = `chat/stickers/${id}`;
	await env.BUCKET.put(r2Key, sticker.body, { httpMetadata: { contentType: sticker.contentType } });
	try {
		await db.insert(chatStickers).values({ id, kind: sticker.kind, name: sticker.name, contentType: sticker.contentType, size: sticker.size, r2Key, createdByUserId: userId, createdAt: Date.now() });
	} catch (error) {
		await env.BUCKET.delete(r2Key).catch(() => undefined);
		throw error;
	}
	return toStickerDto({ id, kind: sticker.kind, name: sticker.name, createdByUserId: userId });
}

export async function getSticker(db: Db, stickerId: string) {
	const [row] = await db.select().from(chatStickers).where(eq(chatStickers.id, stickerId)).limit(1);
	if (!row) throw new ChatError("Not found", 404);
	return row;
}

/** The person who added a sticker, or an administrator of this installation, can remove it. Returns its storage key. */
export async function deleteSticker(db: Db, user: { id: string; role: string }, stickerId: string): Promise<string> {
	const row = await getSticker(db, stickerId);
	if (row.createdByUserId !== user.id && user.role !== "admin") throw new ChatError("Only the person who added it or an administrator can remove it", 403);
	await db.delete(chatStickers).where(eq(chatStickers.id, stickerId));
	return row.r2Key;
}
