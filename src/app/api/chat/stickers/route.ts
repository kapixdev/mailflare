import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { CHAT_STICKER_MAX_BYTES, createSticker, listStickers } from "@/lib/chat/content-service";
import { normalizeUploadName, normalizeUploadType, readUploadLength } from "@/lib/chat/files";
import { chatErrorResponse } from "@/lib/chat/route-utils";

/** The installation's shared library of custom stickers and GIFs. */
export async function GET(request: Request) {
	const auth = await authorizeChat(request);
	if (auth.error) return auth.error;
	try {
		return NextResponse.json({ stickers: await listStickers(auth.db) });
	} catch (error) {
		return chatErrorResponse(error);
	}
}

/** Adds a sticker or GIF. The raw image is the request body. Query: ?name=<label>&kind=sticker|gif. */
export async function PUT(request: Request) {
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	const size = readUploadLength(request, CHAT_STICKER_MAX_BYTES);
	if (typeof size !== "number") return NextResponse.json({ error: size.error }, { status: size.status });
	const url = new URL(request.url);
	try {
		const sticker = await createSticker(auth.env, auth.db, auth.user.id, {
			name: normalizeUploadName(url.searchParams.get("name"), "sticker").slice(0, 60),
			kind: url.searchParams.get("kind") === "gif" ? "gif" : "sticker",
			contentType: normalizeUploadType(request.headers.get("Content-Type")),
			size,
			body: request.body!,
		});
		return NextResponse.json({ sticker }, { status: 201 });
	} catch (error) {
		return chatErrorResponse(error);
	}
}
