import { and, eq, isNull } from "drizzle-orm";
import { users } from "@/db/schema";
import { getAvatarImageResponse } from "@/lib/avatar-images";
import { authorizeChat } from "@/lib/chat/auth";

/** Avatar of an active user, for chat member lists; chat's directory is installation-wide. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const auth = await authorizeChat(request);
	if (auth.error) return auth.error;
	const [row] = await auth.db
		.select({ avatarKey: users.avatarKey })
		.from(users)
		.where(and(eq(users.id, id), eq(users.disabled, false), isNull(users.deletedAt)))
		.limit(1);
	if (!row?.avatarKey) return new Response("Not found", { status: 404 });
	return getAvatarImageResponse(request, auth.env.BUCKET, row.avatarKey);
}
