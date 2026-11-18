import { asc, inArray } from "drizzle-orm";
import type { getDb } from "@/db";
import { chatAttachments, chatReactions } from "@/db/schema";
import { getInlineContentType } from "@/lib/http/content-type";
import type { ChatAttachmentDto, ChatMessageDto, ChatReactionDto, ChatStickerDto, ChatStickerKind } from "./types";

type Db = ReturnType<typeof getDb>;

const IMAGE_PREVIEW_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"]);

export function toAttachmentDto(row: { id: string; name: string; size: number; contentType: string }): ChatAttachmentDto {
	const inline = getInlineContentType(row.contentType);
	return {
		id: row.id,
		name: row.name,
		size: Number(row.size),
		contentType: row.contentType,
		url: `/api/chat/attachments/${encodeURIComponent(row.id)}`,
		image: inline !== null && IMAGE_PREVIEW_TYPES.has(inline),
	};
}

export function toStickerDto(row: { id: string; kind: ChatStickerKind; name: string; createdByUserId?: string | null }): ChatStickerDto {
	return {
		id: row.id,
		kind: row.kind,
		name: row.name,
		url: `/api/chat/stickers/${encodeURIComponent(row.id)}`,
		...(row.createdByUserId !== undefined ? { createdByUserId: row.createdByUserId } : {}),
	};
}

/** Groups reaction rows into one entry per emoji, in the order each emoji was first used. */
export function groupReactions(rows: { emoji: string; userId: string }[]): ChatReactionDto[] {
	const byEmoji = new Map<string, ChatReactionDto>();
	for (const row of rows) {
		const entry = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, userIds: [] };
		entry.count += 1;
		entry.userIds.push(row.userId);
		byEmoji.set(row.emoji, entry);
	}
	return [...byEmoji.values()];
}

/** Loads attachments and reactions for a page of messages (at most ~100, so one IN list each). */
export async function hydrateMessages(db: Db, messages: ChatMessageDto[]): Promise<ChatMessageDto[]> {
	if (messages.length === 0) return messages;
	const ids = messages.map((message) => message.id);
	const [attachmentRows, reactionRows] = await Promise.all([
		db
			.select({ id: chatAttachments.id, messageId: chatAttachments.messageId, name: chatAttachments.name, size: chatAttachments.size, contentType: chatAttachments.contentType })
			.from(chatAttachments)
			.where(inArray(chatAttachments.messageId, ids))
			.orderBy(asc(chatAttachments.createdAt)),
		db
			.select({ messageId: chatReactions.messageId, emoji: chatReactions.emoji, userId: chatReactions.userId })
			.from(chatReactions)
			.where(inArray(chatReactions.messageId, ids))
			.orderBy(asc(chatReactions.createdAt)),
	]);
	const attachmentsByMessage = new Map<string, ChatAttachmentDto[]>();
	for (const row of attachmentRows) {
		if (!row.messageId) continue;
		const list = attachmentsByMessage.get(row.messageId) ?? [];
		list.push(toAttachmentDto(row));
		attachmentsByMessage.set(row.messageId, list);
	}
	const reactionsByMessage = new Map<string, { emoji: string; userId: string }[]>();
	for (const row of reactionRows) {
		const list = reactionsByMessage.get(row.messageId) ?? [];
		list.push(row);
		reactionsByMessage.set(row.messageId, list);
	}
	return messages.map((message) => ({
		...message,
		attachments: attachmentsByMessage.get(message.id) ?? [],
		reactions: groupReactions(reactionsByMessage.get(message.id) ?? []),
	}));
}
