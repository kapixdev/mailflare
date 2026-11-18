import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { deleteMessage, editMessage } from "@/lib/chat/content-service";
import { deleteChatObjects } from "@/lib/chat/files";
import { broadcastChatEvent } from "@/lib/chat/notify";
import { chatErrorResponse, readJson } from "@/lib/chat/route-utils";
import { getMemberUserIds, getMessageDto } from "@/lib/chat/service";
import type { ChatMessageParams } from "@/lib/chat/types";

/** Edits your own message. Body: { body }. */
export async function PATCH(request: Request, { params }: ChatMessageParams) {
	const { messageId } = await params;
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	const { env, db, user } = auth;
	const body = await readJson<{ body: string }>(request);
	try {
		const message = await editMessage(db, user.id, messageId, body.body);
		await broadcastChatEvent(env, await getMemberUserIds(db, message.conversationId), {
			type: "chat", event: "update", conversationId: message.conversationId, messageId, parentMessageId: message.parentMessageId ?? undefined, message,
		});
		return NextResponse.json({ message });
	} catch (error) {
		return chatErrorResponse(error);
	}
}

/** Deletes a message: your own, or any message in a space you administer. */
export async function DELETE(request: Request, { params }: ChatMessageParams) {
	const { messageId } = await params;
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	const { env, db, user } = auth;
	try {
		const { conversationId, parentMessageId, keys } = await deleteMessage(db, user.id, messageId);
		await deleteChatObjects(env, keys);
		const memberIds = await getMemberUserIds(db, conversationId);
		await broadcastChatEvent(env, memberIds, { type: "chat", event: "delete", conversationId, messageId, parentMessageId: parentMessageId ?? undefined });
		if (parentMessageId) {
			const parent = await getMessageDto(db, parentMessageId);
			if (parent) await broadcastChatEvent(env, memberIds, { type: "chat", event: "update", conversationId, messageId: parentMessageId, message: parent });
		}
		return NextResponse.json({ ok: true });
	} catch (error) {
		return chatErrorResponse(error);
	}
}
