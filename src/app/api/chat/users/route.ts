import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { chatErrorResponse } from "@/lib/chat/route-utils";
import { listDirectory } from "@/lib/chat/service";

/** People in this installation the current user can chat with. */
export async function GET(request: Request) {
	const auth = await authorizeChat(request);
	if (auth.error) return auth.error;
	try {
		return NextResponse.json({ users: await listDirectory(auth.db, auth.user.id) });
	} catch (error) {
		return chatErrorResponse(error);
	}
}
