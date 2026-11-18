import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { broadcastChatEvent } from "@/lib/chat/notify";
import { chatErrorResponse, readJson } from "@/lib/chat/route-utils";
import { getConversation, getMemberUserIds, updateSpace } from "@/lib/chat/service";
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

/** Updates a space (admins only). Body: { name?, postPolicy? }. */
export async function PATCH(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	const { env, db, user } = auth;
	const body = await readJson<{ name: string; postPolicy: string }>(request);
	try {
		await updateSpace(db, user.id, id, { name: body.name, postPolicy: body.postPolicy });
		await broadcastChatEvent(env, await getMemberUserIds(db, id), { type: "chat", event: "conversation", conversationId: id });
		return NextResponse.json({ conversation: await getConversation(db, user.id, id) });
	} catch (error) {
		return chatErrorResponse(error);
	}
}
