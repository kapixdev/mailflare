import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { broadcastChatEvent } from "@/lib/chat/notify";
import { chatErrorResponse } from "@/lib/chat/route-utils";
import { markRead } from "@/lib/chat/service";
import type { ChatConversationParams } from "@/lib/chat/types";

/** Marks the conversation read and tells the user's other tabs and devices to clear its badge. */
export async function POST(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	try {
		const readAt = await markRead(auth.db, auth.user.id, id);
		await broadcastChatEvent(auth.env, [auth.user.id], { type: "chat", event: "read", conversationId: id });
		return NextResponse.json({ readAt });
	} catch (error) {
		return chatErrorResponse(error);
	}
}
