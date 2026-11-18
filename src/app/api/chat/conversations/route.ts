import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { broadcastChatEvent } from "@/lib/chat/notify";
import { chatErrorResponse, readJson, toIdList } from "@/lib/chat/route-utils";
import { createDirect, createSpace, getConversation, getMemberUserIds, listConversations } from "@/lib/chat/service";
import { isMissingTableError } from "@/lib/database-errors";

export async function GET(request: Request) {
	const auth = await authorizeChat(request);
	if (auth.error) return auth.error;
	try {
		return NextResponse.json({ conversations: await listConversations(auth.db, auth.user.id) });
	} catch (error) {
		if (isMissingTableError(error)) return NextResponse.json({ conversations: [], unavailable: true });
		return chatErrorResponse(error);
	}
}

/** Body: { type: "direct", userId } or { type: "space", name, userIds }. */
export async function POST(request: Request) {
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	const { env, db, user } = auth;
	const body = await readJson<{ type: string; userId: string; name: string; userIds: string[] }>(request);
	try {
		let id: string;
		let created = true;
		if (body.type === "space") {
			id = await createSpace(db, user.id, body.name, toIdList(body.userIds));
		} else {
			({ id, created } = await createDirect(db, user.id, typeof body.userId === "string" ? body.userId : ""));
		}
		const conversation = await getConversation(db, user.id, id);
		if (created) await broadcastChatEvent(env, await getMemberUserIds(db, id), { type: "chat", event: "conversation", conversationId: id });
		return NextResponse.json({ conversation }, { status: created ? 201 : 200 });
	} catch (error) {
		return chatErrorResponse(error);
	}
}
