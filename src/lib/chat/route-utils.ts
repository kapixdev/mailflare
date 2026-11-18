import { NextResponse } from "next/server";
import { isMissingTableError } from "@/lib/database-errors";
import { ChatError } from "./service";

/** Turns chat service errors into JSON responses; a missing table means the chat migration is not applied yet. */
export function chatErrorResponse(error: unknown): NextResponse {
	if (error instanceof ChatError) return NextResponse.json({ error: error.message }, { status: error.status });
	if (isMissingTableError(error)) {
		return NextResponse.json({ error: "Chat is not set up yet. An administrator needs to apply the pending database migration.", unavailable: true }, { status: 503 });
	}
	console.error("Chat request failed", error);
	return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<Partial<T>> {
	return await request.json().catch(() => ({})) as Partial<T>;
}

export function toIdList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
}
