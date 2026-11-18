import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { deleteSticker, getSticker } from "@/lib/chat/content-service";
import { deleteChatObjects, streamChatFile } from "@/lib/chat/files";
import { chatErrorResponse } from "@/lib/chat/route-utils";
import type { ChatConversationParams } from "@/lib/chat/types";

export async function GET(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request);
	if (auth.error) return auth.error;
	try {
		const sticker = await getSticker(auth.db, id);
		return await streamChatFile(auth.env, request, sticker, { download: false, cache: "immutable" });
	} catch (error) {
		return chatErrorResponse(error);
	}
}

export const HEAD = GET;

/** Removes a sticker from the library: whoever added it, or an administrator. Messages that used it show a placeholder. */
export async function DELETE(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	try {
		await deleteChatObjects(auth.env, [await deleteSticker(auth.db, auth.user, id)]);
		return NextResponse.json({ ok: true });
	} catch (error) {
		return chatErrorResponse(error);
	}
}
