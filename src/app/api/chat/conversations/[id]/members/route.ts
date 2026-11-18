import { NextResponse } from "next/server";
import { authorizeChat } from "@/lib/chat/auth";
import { broadcastChatEvent } from "@/lib/chat/notify";
import { chatErrorResponse, readJson, toIdList } from "@/lib/chat/route-utils";
import { deleteChatObjects } from "@/lib/chat/files";
import { addMembers, getConversation, getMemberUserIds, removeMember, setMemberRole } from "@/lib/chat/service";
import type { ChatConversationParams } from "@/lib/chat/types";

/** Adds people to a space. Body: { userIds }. */
export async function POST(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	const { env, db, user } = auth;
	const body = await readJson<{ userIds: string[] }>(request);
	try {
		const added = await addMembers(db, user.id, id, toIdList(body.userIds));
		if (added.length) await broadcastChatEvent(env, await getMemberUserIds(db, id), { type: "chat", event: "conversation", conversationId: id });
		return NextResponse.json({ conversation: await getConversation(db, user.id, id) });
	} catch (error) {
		return chatErrorResponse(error);
	}
}

/** Leaves a space, or (owner and admins) removes someone. Query: ?userId=<id>, defaults to yourself. */
export async function DELETE(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	const { env, db, user } = auth;
	const targetUserId = new URL(request.url).searchParams.get("userId") || user.id;
	try {
		const before = await getMemberUserIds(db, id);
		const keys = await removeMember(db, user.id, id, targetUserId);
		await deleteChatObjects(env, keys);
		await broadcastChatEvent(env, before, { type: "chat", event: "conversation", conversationId: id });
		return NextResponse.json({ ok: true });
	} catch (error) {
		return chatErrorResponse(error);
	}
}

/** Makes someone an admin of the space or back to a member (owner and admins only). Body: { userId, role }. */
export async function PATCH(request: Request, { params }: ChatConversationParams) {
	const { id } = await params;
	const auth = await authorizeChat(request, true);
	if (auth.error) return auth.error;
	const { env, db, user } = auth;
	const body = await readJson<{ userId: string; role: string }>(request);
	try {
		await setMemberRole(db, user.id, id, typeof body.userId === "string" ? body.userId : "", body.role);
		await broadcastChatEvent(env, await getMemberUserIds(db, id), { type: "chat", event: "conversation", conversationId: id });
		return NextResponse.json({ conversation: await getConversation(db, user.id, id) });
	} catch (error) {
		return chatErrorResponse(error);
	}
}
