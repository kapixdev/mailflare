import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { notifyChatMessage } from "@/lib/chat/notify";
import { chatErrorResponse, readJson } from "@/lib/chat/route-utils";
import { getMemberUserIds, listMessages, sendMessage } from "@/lib/chat/service";
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

/** Body: { body }. */
export async function POST(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	const { env, db, user } = auth;
	const body = await readJson<{ body: string }>(request);
	try {
		const { message, conversation } = await sendMessage(db, user, id, body.body);
		await notifyChatMessage(env, await getMemberUserIds(db, id), message, conversation);
		return NextResponse.json({ message }, { status: 201 });
	} catch (error) {
		return chatErrorResponse(error);
	}
}
