import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { CHAT_ATTACHMENT_MAX_BYTES, createAttachment } from "@/lib/chat/content-service";
import { deleteChatObjects, normalizeUploadName, normalizeUploadType, readUploadLength } from "@/lib/chat/files";
import { chatErrorResponse } from "@/lib/chat/route-utils";
import type { ChatConversationParams } from "@/lib/chat/types";

/**
 * Uploads one file as an unsent attachment; send it by passing its id in a message's attachmentIds.
 * The raw file is the request body (not multipart), so large files stream straight to storage.
 * Query: ?name=<file name>. The Content-Type header is the file's type.
 */
export async function PUT(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	const { env, db, user } = auth;
	const size = readUploadLength(request, CHAT_ATTACHMENT_MAX_BYTES);
	if (typeof size !== "number") return NextResponse.json({ error: size.error }, { status: size.status });
	try {
		const { attachment, abandonedKeys } = await createAttachment(env, db, user.id, id, {
			name: normalizeUploadName(new URL(request.url).searchParams.get("name"), "file"),
			contentType: normalizeUploadType(request.headers.get("Content-Type")),
			size,
			body: request.body!,
		});
		await deleteChatObjects(env, abandonedKeys);
		return NextResponse.json({ attachment }, { status: 201 });
	} catch (error) {
		return chatErrorResponse(error);
	}
}
