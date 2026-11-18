import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { broadcastChatEvent } from "@/lib/chat/notify";
import { chatErrorResponse, readJson } from "@/lib/chat/route-utils";
import { getConversation, getMemberUserIds, renameSpace } from "@/lib/chat/service";
import type { ChatConversationParams } from "@/lib/chat/types";

export async function GET(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request);
	if (auth.error) return auth.error;
	try {
		return NextResponse.json({ conversation: await getConversation(auth.db, auth.user.id, id) });
	} catch (error) {
		return chatErrorResponse(error);
	}
}

/** Renames a space. Body: { name }. */
export async function PATCH(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	const { env, db, user } = auth;
	const body = await readJson<{ name: string }>(request);
	try {
		await renameSpace(db, user.id, id, body.name);
		await broadcastChatEvent(env, await getMemberUserIds(db, id), { type: "chat", event: "conversation", conversationId: id });
		return NextResponse.json({ conversation: await getConversation(db, user.id, id) });
	} catch (error) {
		return chatErrorResponse(error);
	}
}
