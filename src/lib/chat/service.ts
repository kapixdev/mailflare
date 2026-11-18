import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { getDb } from "@/db";
import { chatAttachments, chatConversations, chatMembers, chatMessages, chatStickers, users } from "@/db/schema";
import { isUniqueConstraintError } from "@/lib/database-errors";
import { hydrateMessages, toAttachmentDto, toStickerDto } from "./extras";
import { canPostTopLevel, canReplyInThread, isChatAdmin, isPostPolicy } from "./permissions";
import type { ChatConversationDto, ChatMemberDto, ChatMessageDto, ChatStickerKind, ChatUserDto } from "./types";

type Db = ReturnType<typeof getDb>;

export const CHAT_MESSAGE_MAX_LENGTH = 4000;
export const CHAT_SPACE_NAME_MAX_LENGTH = 80;
const CHAT_MAX_NEW_MEMBERS = 50;
export const CHAT_MAX_ATTACHMENTS_PER_MESSAGE = 10;
const CONVERSATION_LIST_LIMIT = 200;

export class ChatError extends Error {
	constructor(message: string, public status = 400) {
		super(message);
	}
}

function toUserDto(row: { id: string; name: string | null; email: string; avatarKey: string | null }): ChatUserDto {
	return {
		id: row.id,
		name: row.name?.trim() || row.email,
		email: row.email,
		avatarUrl: row.avatarKey ? `/api/chat/users/${encodeURIComponent(row.id)}/avatar` : null,
	};
}

const messageColumns = {
	id: chatMessages.id,
	conversationId: chatMessages.conversationId,
	senderUserId: chatMessages.senderUserId,
	senderName: users.name,
	senderEmail: users.email,
	body: chatMessages.body,
	sentAt: chatMessages.sentAt,
	editedAt: chatMessages.editedAt,
	parentMessageId: chatMessages.parentMessageId,
	replyCount: chatMessages.replyCount,
	lastReplyAt: chatMessages.lastReplyAt,
	stickerId: chatStickers.id,
	stickerKind: chatStickers.kind,
	stickerName: chatStickers.name,
};

function toMessageDto(row: {
	id: string;
	conversationId: string;
	senderUserId: string | null;
	senderName: string | null;
	senderEmail: string | null;
	body: string;
	sentAt: number;
	editedAt: number | null;
	parentMessageId: string | null;
	replyCount: number;
	lastReplyAt: number | null;
	stickerId: string | null;
	stickerKind: ChatStickerKind | null;
	stickerName: string | null;
}): ChatMessageDto {
	return {
		id: row.id,
		conversationId: row.conversationId,
		senderUserId: row.senderUserId,
		senderName: row.senderName?.trim() || row.senderEmail || null,
		body: row.body,
		sentAt: Number(row.sentAt),
		editedAt: row.editedAt == null ? null : Number(row.editedAt),
		parentMessageId: row.parentMessageId,
		replyCount: Number(row.replyCount) || 0,
		lastReplyAt: row.lastReplyAt == null ? null : Number(row.lastReplyAt),
		sticker: row.stickerId ? toStickerDto({ id: row.stickerId, kind: row.stickerKind ?? "sticker", name: row.stickerName ?? "" }) : null,
		attachments: [],
		reactions: [],
	};
}

const activeUser = and(eq(users.disabled, false), isNull(users.deletedAt));

/** Users of this installation someone can start a chat with. */
export async function listDirectory(db: Db, currentUserId: string): Promise<ChatUserDto[]> {
	const rows = await db
		.select({ id: users.id, name: users.name, email: users.email, avatarKey: users.avatarKey })
		.from(users)
		.where(and(activeUser, ne(users.id, currentUserId)))
		.orderBy(asc(users.name), asc(users.email))
		.limit(500);
	return rows.map(toUserDto);
}

async function getActiveUserIds(db: Db, userIds: string[]): Promise<string[]> {
	const unique = [...new Set(userIds.filter((id) => typeof id === "string" && id))];
	if (unique.length === 0) return [];
	if (unique.length > CHAT_MAX_NEW_MEMBERS) throw new ChatError(`Add at most ${CHAT_MAX_NEW_MEMBERS} people at a time`);
	const rows = await db.select({ id: users.id }).from(users).where(and(activeUser, inArray(users.id, unique)));
	return rows.map((row) => row.id);
}

export async function getMembership(db: Db, conversationId: string, userId: string) {
	const [row] = await db
		.select({
			id: chatConversations.id,
			type: chatConversations.type,
			name: chatConversations.name,
			lastMessageAt: chatConversations.lastMessageAt,
			postPolicy: chatConversations.postPolicy,
			memberId: chatMembers.id,
			role: chatMembers.role,
			lastReadAt: chatMembers.lastReadAt,
		})
		.from(chatMembers)
		.innerJoin(chatConversations, eq(chatMembers.conversationId, chatConversations.id))
		.where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.userId, userId)))
		.limit(1);
	return row ?? null;
}

export async function requireMembership(db: Db, conversationId: string, userId: string) {
	const membership = await getMembership(db, conversationId, userId);
	if (!membership) throw new ChatError("Not found", 404);
	return membership;
}

export async function getMemberUserIds(db: Db, conversationId: string): Promise<string[]> {
	const rows = await db.select({ userId: chatMembers.userId }).from(chatMembers).where(eq(chatMembers.conversationId, conversationId));
	return rows.map((row) => row.userId);
}

/** Every conversation the user belongs to, newest activity first, with members, last message and unread count. */
export async function listConversations(db: Db, userId: string, onlyId?: string): Promise<ChatConversationDto[]> {
	const mine = await db
		.select({
			id: chatConversations.id,
			type: chatConversations.type,
			name: chatConversations.name,
			lastMessageAt: chatConversations.lastMessageAt,
			postPolicy: chatConversations.postPolicy,
			role: chatMembers.role,
			lastReadAt: chatMembers.lastReadAt,
		})
		.from(chatMembers)
		.innerJoin(chatConversations, eq(chatMembers.conversationId, chatConversations.id))
		.where(onlyId ? and(eq(chatMembers.userId, userId), eq(chatMembers.conversationId, onlyId)) : eq(chatMembers.userId, userId))
		.orderBy(desc(chatConversations.lastMessageAt))
		.limit(CONVERSATION_LIST_LIMIT);
	if (mine.length === 0) return [];

	// Subqueries keep the bound parameter count small, whatever the number of conversations.
	const myConversationIds = onlyId
		? db.select({ id: chatMembers.conversationId }).from(chatMembers).where(and(eq(chatMembers.userId, userId), eq(chatMembers.conversationId, onlyId)))
		: db.select({ id: chatMembers.conversationId }).from(chatMembers).where(eq(chatMembers.userId, userId));

	const [memberRows, lastMessageRows, unreadRows] = await Promise.all([
		db
			.select({ conversationId: chatMembers.conversationId, role: chatMembers.role, id: users.id, name: users.name, email: users.email, avatarKey: users.avatarKey })
			.from(chatMembers)
			.innerJoin(users, eq(chatMembers.userId, users.id))
			.where(inArray(chatMembers.conversationId, myConversationIds))
			.orderBy(asc(chatMembers.joinedAt)),
		db
			.select(messageColumns)
			.from(chatMessages)
			.innerJoin(chatConversations, and(eq(chatMessages.conversationId, chatConversations.id), eq(chatMessages.sentAt, chatConversations.lastMessageAt)))
			.leftJoin(users, eq(chatMessages.senderUserId, users.id))
			.leftJoin(chatStickers, eq(chatMessages.stickerId, chatStickers.id))
			.where(inArray(chatMessages.conversationId, myConversationIds)),
		db
			.select({ conversationId: chatMessages.conversationId, count: sql<number>`count(*)` })
			.from(chatMessages)
			.innerJoin(chatMembers, and(eq(chatMembers.conversationId, chatMessages.conversationId), eq(chatMembers.userId, userId)))
			.where(and(
				gt(chatMessages.sentAt, chatMembers.lastReadAt),
				isNull(chatMessages.deletedAt),
				or(isNull(chatMessages.senderUserId), ne(chatMessages.senderUserId, userId)),
				onlyId ? eq(chatMessages.conversationId, onlyId) : undefined,
			))
			.groupBy(chatMessages.conversationId),
	]);

	const membersByConversation = new Map<string, ChatMemberDto[]>();
	for (const row of memberRows) {
		const list = membersByConversation.get(row.conversationId) ?? [];
		list.push({ ...toUserDto(row), role: row.role });
		membersByConversation.set(row.conversationId, list);
	}
	const lastMessageByConversation = new Map<string, ChatMessageDto>();
	for (const row of lastMessageRows) {
		if (!lastMessageByConversation.has(row.conversationId)) lastMessageByConversation.set(row.conversationId, toMessageDto(row));
	}
	const unreadByConversation = new Map(unreadRows.map((row) => [row.conversationId, Number(row.count) || 0]));

	return mine.map((row) => ({
		id: row.id,
		type: row.type,
		name: row.name,
		role: row.role,
		postPolicy: row.postPolicy,
		canPost: canPostTopLevel(row.type, row.postPolicy, row.role),
		canReply: canReplyInThread(row.type, row.postPolicy, row.role),
		members: membersByConversation.get(row.id) ?? [],
		lastMessage: lastMessageByConversation.get(row.id) ?? null,
		lastMessageAt: Number(row.lastMessageAt),
		lastReadAt: Number(row.lastReadAt),
		unreadCount: unreadByConversation.get(row.id) ?? 0,
	}));
}

export async function getConversation(db: Db, userId: string, conversationId: string): Promise<ChatConversationDto> {
	const [conversation] = await listConversations(db, userId, conversationId);
	if (!conversation) throw new ChatError("Not found", 404);
	return conversation;
}

/** Opens the one-to-one conversation between two users, creating it the first time. */
export async function createDirect(db: Db, userId: string, otherUserId: string): Promise<{ id: string; created: boolean }> {
	if (!otherUserId || otherUserId === userId) throw new ChatError("Choose someone else to chat with");
	const [other] = await getActiveUserIds(db, [otherUserId]);
	if (!other) throw new ChatError("User not found", 404);
	const directKey = [userId, other].sort().join(":");
	const findExisting = async () => {
		const [row] = await db.select({ id: chatConversations.id }).from(chatConversations).where(eq(chatConversations.directKey, directKey)).limit(1);
		return row?.id ?? null;
	};
	const existing = await findExisting();
	if (existing) return { id: existing, created: false };

	const id = crypto.randomUUID();
	try {
		await db.insert(chatConversations).values({ id, type: "direct", directKey, createdByUserId: userId, lastMessageAt: Date.now() });
	} catch (error) {
		if (!isUniqueConstraintError(error)) throw error;
		const raced = await findExisting();
		if (raced) return { id: raced, created: false };
		throw error;
	}
	await db.insert(chatMembers).values([
		{ id: crypto.randomUUID(), conversationId: id, userId, role: "member" },
		{ id: crypto.randomUUID(), conversationId: id, userId: other, role: "member" },
	]);
	return { id, created: true };
}

export function normalizeSpaceName(value: unknown): string {
	const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
	if (!name) throw new ChatError("Enter a name for the space");
	return name.slice(0, CHAT_SPACE_NAME_MAX_LENGTH);
}

export async function createSpace(db: Db, userId: string, rawName: unknown, memberIds: string[]): Promise<string> {
	const name = normalizeSpaceName(rawName);
	const others = (await getActiveUserIds(db, memberIds)).filter((id) => id !== userId);
	const id = crypto.randomUUID();
	await db.insert(chatConversations).values({ id, type: "space", name, createdByUserId: userId, lastMessageAt: Date.now() });
	await db.insert(chatMembers).values([
		{ id: crypto.randomUUID(), conversationId: id, userId, role: "owner" },
		...others.map((memberId) => ({ id: crypto.randomUUID(), conversationId: id, userId: memberId, role: "member" as const })),
	]);
	return id;
}

/** Owner and admins can rename a space and choose who may post in it. */
export async function updateSpace(db: Db, userId: string, conversationId: string, changes: { name?: unknown; postPolicy?: unknown }): Promise<void> {
	const membership = await requireMembership(db, conversationId, userId);
	if (membership.type !== "space") throw new ChatError("Only spaces can be changed");
	if (!isChatAdmin(membership.role)) throw new ChatError("Only the owner or an admin can change this space", 403);
	const update: { name?: string; postPolicy?: ChatConversationDto["postPolicy"] } = {};
	if (changes.name !== undefined) update.name = normalizeSpaceName(changes.name);
	if (changes.postPolicy !== undefined) {
		if (!isPostPolicy(changes.postPolicy)) throw new ChatError("Choose who can post");
		update.postPolicy = changes.postPolicy;
	}
	if (Object.keys(update).length === 0) return;
	await db.update(chatConversations).set(update).where(eq(chatConversations.id, conversationId));
}

/** Owner and admins can make a member an admin or take it back; the owner's role never changes here. */
export async function setMemberRole(db: Db, userId: string, conversationId: string, targetUserId: string, role: unknown): Promise<void> {
	const membership = await requireMembership(db, conversationId, userId);
	if (membership.type !== "space") throw new ChatError("Only spaces have admins");
	if (!isChatAdmin(membership.role)) throw new ChatError("Only the owner or an admin can change roles", 403);
	if (role !== "admin" && role !== "member") throw new ChatError("Choose admin or member");
	const target = await getMembership(db, conversationId, targetUserId);
	if (!target) throw new ChatError("Not found", 404);
	if (target.role === "owner") throw new ChatError("The owner's role can't be changed", 403);
	await db.update(chatMembers).set({ role }).where(eq(chatMembers.id, target.memberId));
}

/** Any member of a space can add people, as in most team chat apps. Returns the ids actually added. */
export async function addMembers(db: Db, userId: string, conversationId: string, memberIds: string[]): Promise<string[]> {
	const membership = await requireMembership(db, conversationId, userId);
	if (membership.type !== "space") throw new ChatError("People can only be added to spaces");
	const candidates = await getActiveUserIds(db, memberIds);
	const current = new Set(await getMemberUserIds(db, conversationId));
	const added = candidates.filter((id) => !current.has(id));
	for (const memberId of added) {
		try {
			await db.insert(chatMembers).values({ id: crypto.randomUUID(), conversationId, userId: memberId, role: "member" });
		} catch (error) {
			if (!isUniqueConstraintError(error)) throw error;
		}
	}
	return added;
}

/** Storage keys of every file sent in a conversation, to delete from R2 along with it. */
async function conversationObjectKeys(db: Db, conversationId: string): Promise<string[]> {
	const rows = await db.select({ r2Key: chatAttachments.r2Key }).from(chatAttachments).where(eq(chatAttachments.conversationId, conversationId));
	return rows.map((row) => row.r2Key);
}

/**
 * A member may leave a space; the owner and admins may also remove others (admins can't remove the owner).
 * When the owner leaves, the longest-standing admin (or member) takes over. The space is deleted once empty,
 * and the storage keys of its files are returned so the caller can delete them.
 */
export async function removeMember(db: Db, userId: string, conversationId: string, targetUserId: string): Promise<string[]> {
	const membership = await requireMembership(db, conversationId, userId);
	if (membership.type !== "space") throw new ChatError("You can't leave a direct message");
	const target = targetUserId === userId ? membership : await getMembership(db, conversationId, targetUserId);
	if (!target) throw new ChatError("Not found", 404);
	if (targetUserId !== userId) {
		if (!isChatAdmin(membership.role)) throw new ChatError("Only the owner or an admin can remove people", 403);
		if (target.role === "owner") throw new ChatError("The owner can't be removed", 403);
	}
	await db.delete(chatMembers).where(eq(chatMembers.id, target.memberId));
	const remaining = await db
		.select({ id: chatMembers.id, role: chatMembers.role })
		.from(chatMembers)
		.where(eq(chatMembers.conversationId, conversationId))
		.orderBy(asc(chatMembers.joinedAt));
	if (remaining.length === 0) {
		const keys = await conversationObjectKeys(db, conversationId);
		await db.delete(chatConversations).where(eq(chatConversations.id, conversationId));
		return keys;
	}
	if (target.role === "owner" && !remaining.some((row) => row.role === "owner")) {
		const heir = remaining.find((row) => row.role === "admin") ?? remaining[0];
		await db.update(chatMembers).set({ role: "owner" }).where(eq(chatMembers.id, heir.id));
	}
	return [];
}

export async function listMessages(
	db: Db,
	userId: string,
	conversationId: string,
	options: { before?: number | null; limit?: number } = {},
): Promise<{ messages: ChatMessageDto[]; hasMore: boolean }> {
	await requireMembership(db, conversationId, userId);
	const limit = Math.min(Math.max(Math.floor(options.limit ?? 50), 1), 100);
	const rows = await db
		.select(messageColumns)
		.from(chatMessages)
		.leftJoin(users, eq(chatMessages.senderUserId, users.id))
		.leftJoin(chatStickers, eq(chatMessages.stickerId, chatStickers.id))
		.where(and(
			eq(chatMessages.conversationId, conversationId),
			isNull(chatMessages.deletedAt),
			isNull(chatMessages.parentMessageId),
			options.before ? lt(chatMessages.sentAt, options.before) : undefined,
		))
		.orderBy(desc(chatMessages.sentAt), desc(chatMessages.id))
		.limit(limit + 1);
	const hasMore = rows.length > limit;
	return { messages: await hydrateMessages(db, rows.slice(0, limit).reverse().map(toMessageDto)), hasMore };
}

/** One message with its sticker, attachments and reactions, or null when it is gone. */
export async function getMessageDto(db: Db, messageId: string): Promise<ChatMessageDto | null> {
	const [row] = await db
		.select(messageColumns)
		.from(chatMessages)
		.leftJoin(users, eq(chatMessages.senderUserId, users.id))
		.leftJoin(chatStickers, eq(chatMessages.stickerId, chatStickers.id))
		.where(and(eq(chatMessages.id, messageId), isNull(chatMessages.deletedAt)))
		.limit(1);
	if (!row) return null;
	const [message] = await hydrateMessages(db, [toMessageDto(row)]);
	return message;
}

/** A thread: the top-level message and its replies, oldest first. */
export async function listReplies(db: Db, userId: string, messageId: string): Promise<{ parent: ChatMessageDto; replies: ChatMessageDto[] }> {
	const parent = await getMessageDto(db, messageId);
	if (!parent || parent.parentMessageId) throw new ChatError("Not found", 404);
	await requireMembership(db, parent.conversationId, userId);
	const rows = await db
		.select(messageColumns)
		.from(chatMessages)
		.leftJoin(users, eq(chatMessages.senderUserId, users.id))
		.leftJoin(chatStickers, eq(chatMessages.stickerId, chatStickers.id))
		.where(and(eq(chatMessages.parentMessageId, messageId), isNull(chatMessages.deletedAt)))
		.orderBy(desc(chatMessages.sentAt), desc(chatMessages.id))
		.limit(100);
	return { parent, replies: await hydrateMessages(db, rows.reverse().map(toMessageDto)) };
}

export type SendMessageInput = {
	body?: unknown;
	parentMessageId?: unknown;
	attachmentIds?: unknown;
	stickerId?: unknown;
};

export async function sendMessage(
	db: Db,
	sender: { id: string; name: string | null; email: string },
	conversationId: string,
	input: SendMessageInput,
): Promise<{ message: ChatMessageDto; conversation: NonNullable<Awaited<ReturnType<typeof getMembership>>>; parentId: string | null }> {
	const membership = await requireMembership(db, conversationId, sender.id);
	const body = typeof input.body === "string" ? input.body.replace(/\r\n/g, "\n").trim() : "";
	if (body.length > CHAT_MESSAGE_MAX_LENGTH) throw new ChatError(`Messages can be at most ${CHAT_MESSAGE_MAX_LENGTH} characters`);
	const parentId = typeof input.parentMessageId === "string" && input.parentMessageId ? input.parentMessageId : null;
	const stickerId = typeof input.stickerId === "string" && input.stickerId ? input.stickerId : null;
	const attachmentIds = Array.isArray(input.attachmentIds)
		? [...new Set(input.attachmentIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
		: [];
	if (attachmentIds.length > CHAT_MAX_ATTACHMENTS_PER_MESSAGE) throw new ChatError(`Send at most ${CHAT_MAX_ATTACHMENTS_PER_MESSAGE} files at a time`);

	if (parentId) {
		const [parent] = await db
			.select({ id: chatMessages.id })
			.from(chatMessages)
			.where(and(eq(chatMessages.id, parentId), eq(chatMessages.conversationId, conversationId), isNull(chatMessages.parentMessageId), isNull(chatMessages.deletedAt)))
			.limit(1);
		if (!parent) throw new ChatError("That message is no longer available", 404);
		if (!canReplyInThread(membership.type, membership.postPolicy, membership.role)) throw new ChatError("Only admins can reply in this space", 403);
	} else if (!canPostTopLevel(membership.type, membership.postPolicy, membership.role)) {
		throw new ChatError("Only admins can post in this space", 403);
	}

	let sticker: ChatMessageDto["sticker"] = null;
	if (stickerId) {
		const [row] = await db.select({ id: chatStickers.id, kind: chatStickers.kind, name: chatStickers.name }).from(chatStickers).where(eq(chatStickers.id, stickerId)).limit(1);
		if (!row) throw new ChatError("That sticker was deleted", 404);
		sticker = toStickerDto(row);
	}

	const attachmentRows = attachmentIds.length
		? await db
			.select({ id: chatAttachments.id, name: chatAttachments.name, size: chatAttachments.size, contentType: chatAttachments.contentType })
			.from(chatAttachments)
			.where(and(
				inArray(chatAttachments.id, attachmentIds),
				eq(chatAttachments.conversationId, conversationId),
				eq(chatAttachments.uploaderUserId, sender.id),
				isNull(chatAttachments.messageId),
			))
		: [];
	if (attachmentRows.length !== attachmentIds.length) throw new ChatError("A file is no longer available. Attach it again.");
	if (!body && !sticker && attachmentRows.length === 0) throw new ChatError("Write a message first");

	// Keep ordering strictly increasing per conversation even when two messages land in the same millisecond.
	const sentAt = Math.max(Date.now(), Number(membership.lastMessageAt) + 1);
	const id = crypto.randomUUID();
	await db.insert(chatMessages).values({ id, conversationId, senderUserId: sender.id, body, sentAt, parentMessageId: parentId, stickerId: sticker?.id ?? null });
	if (attachmentIds.length) {
		await db.update(chatAttachments).set({ messageId: id }).where(and(inArray(chatAttachments.id, attachmentIds), isNull(chatAttachments.messageId)));
	}
	if (parentId) {
		await db.update(chatMessages).set({ replyCount: sql`${chatMessages.replyCount} + 1`, lastReplyAt: sentAt }).where(eq(chatMessages.id, parentId));
	}
	await db.update(chatConversations).set({ lastMessageAt: sentAt }).where(and(eq(chatConversations.id, conversationId), lt(chatConversations.lastMessageAt, sentAt)));
	await db.update(chatMembers).set({ lastReadAt: sentAt }).where(eq(chatMembers.id, membership.memberId));
	return {
		message: {
			id,
			conversationId,
			senderUserId: sender.id,
			senderName: sender.name?.trim() || sender.email,
			body,
			sentAt,
			editedAt: null,
			parentMessageId: parentId,
			replyCount: 0,
			lastReplyAt: null,
			sticker,
			attachments: attachmentRows.map(toAttachmentDto),
			reactions: [],
		},
		conversation: membership,
		parentId,
	};
}

/** Marks everything up to the conversation's latest message as read. */
export async function markRead(db: Db, userId: string, conversationId: string): Promise<number> {
	const membership = await requireMembership(db, conversationId, userId);
	const readAt = Number(membership.lastMessageAt);
	if (readAt > Number(membership.lastReadAt)) {
		await db.update(chatMembers).set({ lastReadAt: readAt }).where(eq(chatMembers.id, membership.memberId));
	}
	return readAt;
}

/** Total unread messages across every conversation, for the app badge. */
export async function countUnread(db: Db, userId: string): Promise<number> {
	const [row] = await db
		.select({ count: sql<number>`count(*)` })
		.from(chatMessages)
		.innerJoin(chatMembers, and(eq(chatMembers.conversationId, chatMessages.conversationId), eq(chatMembers.userId, userId)))
		.where(and(
			gt(chatMessages.sentAt, chatMembers.lastReadAt),
			isNull(chatMessages.deletedAt),
			or(isNull(chatMessages.senderUserId), ne(chatMessages.senderUserId, userId)),
		));
	return Number(row?.count) || 0;
}
