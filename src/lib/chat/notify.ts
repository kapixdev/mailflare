import { sendPushContent } from "@/lib/push/server";
import type { ChatMessageDto, ChatRealtimeEvent } from "./types";

/** Sends a chat event to every open tab and device of the given users over the realtime hub. */
export async function broadcastChatEvent(env: CloudflareEnv, userIds: string[], payload: ChatRealtimeEvent): Promise<void> {
	// Next dev uses a bindings-only proxy; realtime delivery runs in worker.ts.
	if (!env.REALTIME) return;
	const results = await Promise.allSettled([...new Set(userIds)].map((userId) =>
		env.REALTIME.getByName(userId).fetch("https://mailflare-realtime/notify", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		})));
	for (const result of results) {
		if (result.status === "rejected") console.error("Chat realtime notification failed", result.reason);
	}
}

function truncate(value: string, max: number) {
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** What a push notification shows when a message has no text: the sticker or the first file. */
function previewText(message: ChatMessageDto): string {
	if (message.body.trim()) return message.body;
	if (message.sticker) return message.sticker.kind === "gif" ? `GIF · ${message.sticker.name}` : `Sticker · ${message.sticker.name}`;
	const first = message.attachments[0];
	if (first) return message.attachments.length > 1 ? `📎 ${first.name} +${message.attachments.length - 1}` : `📎 ${first.name}`;
	return "New message";
}

/** Delivers a new message live to every member and as a push notification to everyone but the sender. */
export async function notifyChatMessage(
	env: CloudflareEnv,
	memberUserIds: string[],
	message: ChatMessageDto,
	conversation: { type: "direct" | "space"; name: string | null },
): Promise<void> {
	const recipients = memberUserIds.filter((id) => id !== message.senderUserId);
	const sender = message.senderName || "New message";
	const results = await Promise.allSettled([
		broadcastChatEvent(env, memberUserIds, { type: "chat", event: "message", conversationId: message.conversationId, message }),
		sendPushContent(env, recipients, {
			title: truncate(conversation.type === "space" && conversation.name ? `${sender} · ${conversation.name}` : sender, 180),
			body: truncate(previewText(message), 160),
			tag: `chat-${message.conversationId}`,
			url: `/chat?c=${encodeURIComponent(message.conversationId)}`,
		}),
	]);
	for (const result of results) {
		if (result.status === "rejected") console.error("Chat notification failed", result.reason);
	}
}
