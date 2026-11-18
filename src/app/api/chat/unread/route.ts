import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { countUnread } from "@/lib/chat/service";
import { isMissingTableError } from "@/lib/database-errors";

/** Total unread chat messages, for the apps menu badge. */
export async function GET(request: Request) {
	const auth = await authorizeChat(request);
	if (auth.error) return auth.error;
	try {
		return NextResponse.json({ unread: await countUnread(auth.db, auth.user.id) });
	} catch (error) {
		if (isMissingTableError(error)) return NextResponse.json({ unread: 0, unavailable: true });
		throw error;
	}
}
