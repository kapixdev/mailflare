import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { chatErrorResponse } from "@/lib/chat/route-utils";
import { listReplies } from "@/lib/chat/service";
import type { ChatMessageParams } from "@/lib/chat/types";

/** A thread: its top message and the replies, oldest first. */
export async function GET(request: Request, { params }: ChatMessageParams) {
	const { messageId } = await params;
	const auth = await authorizeChat(request);
	if (auth.error) return auth.error;
	try {
		return NextResponse.json(await listReplies(auth.db, auth.user.id, messageId));
	} catch (error) {
		return chatErrorResponse(error);
	}
}
