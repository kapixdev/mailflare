import type { ChatMemberRole, ChatPostPolicy } from "./types";

type ConversationKind = "direct" | "space";

export const CHAT_POST_POLICIES: readonly ChatPostPolicy[] = ["everyone", "admins", "admins_threads"];

export function isChatAdmin(role: ChatMemberRole): boolean {
	return role === "owner" || role === "admin";
}

/** Whether a member may start a new top-level message. Direct messages are always open. */
export function canPostTopLevel(type: ConversationKind, policy: ChatPostPolicy, role: ChatMemberRole): boolean {
	return type === "direct" || policy === "everyone" || isChatAdmin(role);
}

/** Whether a member may reply in a thread. "admins" makes the space read-only for members, threads included. */
export function canReplyInThread(type: ConversationKind, policy: ChatPostPolicy, role: ChatMemberRole): boolean {
	return type === "direct" || policy !== "admins" || isChatAdmin(role);
}

export function isPostPolicy(value: unknown): value is ChatPostPolicy {
	return typeof value === "string" && (CHAT_POST_POLICIES as readonly string[]).includes(value);
}
