import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { broadcastChatEvent, notifyChatMessage } from "@/lib/chat/notify";
import { chatErrorResponse, readJson, toIdList } from "@/lib/chat/route-utils";
import { getMemberUserIds, getMessageDto, listMessages, sendMessage } from "@/lib/chat/service";
import type { ChatConversationParams } from "@/lib/chat/types";

/** Query: ?before=<epoch ms>&limit=<1-100>. Returns oldest-first messages and whether older ones exist. */
export async function GET(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request);
	if (auth.error) return auth.error;
	const url = new URL(request.url);
	const before = Number(url.searchParams.get("before")) || null;
	const limit = Number(url.searchParams.get("limit")) || 50;
	try {
		return NextResponse.json(await listMessages(auth.db, auth.user.id, id, { before, limit }));
	} catch (error) {
		return chatErrorResponse(error);
	}
}

/** Body: { body?, parentMessageId?, attachmentIds?, stickerId? }. A parentMessageId posts a reply in that thread. */
export async function POST(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	const { env, db, user } = auth;
	const body = await readJson<{ body: string; parentMessageId: string; attachmentIds: string[]; stickerId: string }>(request);
	try {
		const { message, conversation, parentId } = await sendMessage(db, user, id, {
			body: body.body,
			parentMessageId: typeof body.parentMessageId === "string" ? body.parentMessageId : undefined,
			attachmentIds: toIdList(body.attachmentIds),
			stickerId: typeof body.stickerId === "string" ? body.stickerId : undefined,
		});
		const memberIds = await getMemberUserIds(db, id);
		await notifyChatMessage(env, memberIds, message, conversation);
		if (parentId) {
			const parent = await getMessageDto(db, parentId);
			if (parent) await broadcastChatEvent(env, memberIds, { type: "chat", event: "update", conversationId: id, messageId: parentId, message: parent });
		}
		return NextResponse.json({ message }, { status: 201 });
	} catch (error) {
		return chatErrorResponse(error);
	}
}
