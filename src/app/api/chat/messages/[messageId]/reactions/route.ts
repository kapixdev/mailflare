import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { toggleReaction } from "@/lib/chat/content-service";
import { broadcastChatEvent } from "@/lib/chat/notify";
import { chatErrorResponse, readJson } from "@/lib/chat/route-utils";
import { getMemberUserIds } from "@/lib/chat/service";
import type { ChatMessageParams } from "@/lib/chat/types";

/** Adds your reaction, or removes it if you already reacted with that emoji. Body: { emoji }. */
export async function POST(request: Request, { params }: ChatMessageParams) {
	const { messageId } = await params;
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	const { env, db, user } = auth;
	const body = await readJson<{ emoji: string }>(request);
	try {
		const message = await toggleReaction(db, user.id, messageId, body.emoji);
		await broadcastChatEvent(env, await getMemberUserIds(db, message.conversationId), {
			type: "chat", event: "update", conversationId: message.conversationId, messageId, parentMessageId: message.parentMessageId ?? undefined, message,
		});
		return NextResponse.json({ message });
	} catch (error) {
		return chatErrorResponse(error);
	}
}
