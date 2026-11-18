import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { deleteUnsentAttachment, getAttachmentForUser } from "@/lib/chat/content-service";
import { deleteChatObjects, streamChatFile } from "@/lib/chat/files";
import { chatErrorResponse } from "@/lib/chat/route-utils";
import type { ChatConversationParams } from "@/lib/chat/types";

/** Opens a chat file. Query: ?download=1 to save it instead of showing it. */
export async function GET(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request);
	if (auth.error) return auth.error;
	try {
		const file = await getAttachmentForUser(auth.db, auth.user.id, id);
		const download = new URL(request.url).searchParams.get("download") === "1";
		return await streamChatFile(auth.env, request, file, { download, cache: "none" });
	} catch (error) {
		return chatErrorResponse(error);
	}
}

export const HEAD = GET;

/** Removes a file you attached but haven't sent yet. */
export async function DELETE(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	try {
		await deleteChatObjects(auth.env, [await deleteUnsentAttachment(auth.db, auth.user.id, id)]);
		return NextResponse.json({ ok: true });
	} catch (error) {
		return chatErrorResponse(error);
	}
}
