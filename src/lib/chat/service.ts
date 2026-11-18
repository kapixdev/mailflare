import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { getDb } from "@/db";
import { chatConversations, chatMembers, chatMessages, users } from "@/db/schema";
import { isUniqueConstraintError } from "@/lib/database-errors";
import type { ChatConversationDto, ChatMessageDto, ChatUserDto } from "./types";

type Db = ReturnType<typeof getDb>;

export const CHAT_MESSAGE_MAX_LENGTH = 4000;
export const CHAT_SPACE_NAME_MAX_LENGTH = 80;
const CHAT_MAX_NEW_MEMBERS = 50;
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
}): ChatMessageDto {
	return {
		id: row.id,
		conversationId: row.conversationId,
		senderUserId: row.senderUserId,
		senderName: row.senderName?.trim() || row.senderEmail || null,
		body: row.body,
		sentAt: Number(row.sentAt),
		editedAt: row.editedAt == null ? null : Number(row.editedAt),
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
			.select({ conversationId: chatMembers.conversationId, id: users.id, name: users.name, email: users.email, avatarKey: users.avatarKey })
			.from(chatMembers)
			.innerJoin(users, eq(chatMembers.userId, users.id))
			.where(inArray(chatMembers.conversationId, myConversationIds))
			.orderBy(asc(chatMembers.joinedAt)),
		db
			.select(messageColumns)
			.from(chatMessages)
			.innerJoin(chatConversations, and(eq(chatMessages.conversationId, chatConversations.id), eq(chatMessages.sentAt, chatConversations.lastMessageAt)))
			.leftJoin(users, eq(chatMessages.senderUserId, users.id))
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

	const membersByConversation = new Map<string, ChatUserDto[]>();
	for (const row of memberRows) {
		const list = membersByConversation.get(row.conversationId) ?? [];
		list.push(toUserDto(row));
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

export async function renameSpace(db: Db, userId: string, conversationId: string, rawName: unknown): Promise<void> {
	const membership = await requireMembership(db, conversationId, userId);
	if (membership.type !== "space") throw new ChatError("Only spaces can be renamed");
	await db.update(chatConversations).set({ name: normalizeSpaceName(rawName) }).where(eq(chatConversations.id, conversationId));
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

/** A member may leave a space; the owner may also remove others. The space is deleted once empty. */
export async function removeMember(db: Db, userId: string, conversationId: string, targetUserId: string): Promise<void> {
	const membership = await requireMembership(db, conversationId, userId);
	if (membership.type !== "space") throw new ChatError("You can't leave a direct message");
	if (targetUserId !== userId && membership.role !== "owner") throw new ChatError("Only the owner can remove people", 403);
	await db.delete(chatMembers).where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.userId, targetUserId)));
	const remaining = await getMemberUserIds(db, conversationId);
	if (remaining.length === 0) await db.delete(chatConversations).where(eq(chatConversations.id, conversationId));
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
		.where(and(
			eq(chatMessages.conversationId, conversationId),
			isNull(chatMessages.deletedAt),
			options.before ? lt(chatMessages.sentAt, options.before) : undefined,
		))
		.orderBy(desc(chatMessages.sentAt), desc(chatMessages.id))
		.limit(limit + 1);
	const hasMore = rows.length > limit;
	return { messages: rows.slice(0, limit).reverse().map(toMessageDto), hasMore };
}

export async function sendMessage(
	db: Db,
	sender: { id: string; name: string | null; email: string },
	conversationId: string,
	rawBody: unknown,
): Promise<{ message: ChatMessageDto; conversation: NonNullable<Awaited<ReturnType<typeof getMembership>>> }> {
	const membership = await requireMembership(db, conversationId, sender.id);
	const body = typeof rawBody === "string" ? rawBody.replace(/\r\n/g, "\n").trim() : "";
	if (!body) throw new ChatError("Write a message first");
	if (body.length > CHAT_MESSAGE_MAX_LENGTH) throw new ChatError(`Messages can be at most ${CHAT_MESSAGE_MAX_LENGTH} characters`);
	// Keep ordering strictly increasing per conversation even when two messages land in the same millisecond.
	const sentAt = Math.max(Date.now(), Number(membership.lastMessageAt) + 1);
	const id = crypto.randomUUID();
	await db.insert(chatMessages).values({ id, conversationId, senderUserId: sender.id, body, sentAt });
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
		},
		conversation: membership,
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
