import { parseByteRange } from "@/lib/drive/content";
import { driveContentDisposition } from "@/lib/drive/utils";
import { getInlineContentType } from "@/lib/http/content-type";

export type ChatStoredFile = {
	id: string;
	name: string;
	contentType: string;
	size: number;
	r2Key: string;
	createdAt: number;
};

/** The client sends the file name in the query string; keep it short and free of path or control characters. */
export function normalizeUploadName(value: string | null, fallback: string): string {
	const name = (value ?? "").replace(/[\u0000-\u001f\u007f/\\]/g, "_").replace(/\s+/g, " ").trim().slice(0, 200);
	return name || fallback;
}

export function normalizeUploadType(value: string | null): string {
	const essence = (value ?? "").split(";", 1)[0].trim().toLowerCase();
	return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(essence) ? essence.slice(0, 120) : "application/octet-stream";
}

/** Reads and checks Content-Length, since R2 needs a known length to stream a request body. */
export function readUploadLength(request: Request, max: number): number | { error: string; status: number } {
	const length = Number(request.headers.get("Content-Length"));
	if (!Number.isFinite(length) || length <= 0) return { error: "The file is empty", status: 400 };
	if (length > max) return { error: `Files can be at most ${Math.round(max / (1024 * 1024))} MB`, status: 413 };
	if (!request.body) return { error: "The file is empty", status: 400 };
	return length;
}

/**
 * Serves a chat file with the same safety headers as Drive: only types a browser shows without running script
 * render inline, everything else downloads; ranges let video and audio seek.
 */
export async function streamChatFile(
	env: CloudflareEnv,
	request: Request,
	file: ChatStoredFile,
	options: { download: boolean; cache: "none" | "immutable" },
): Promise<Response> {
	const inlineType = options.download ? null : getInlineContentType(file.contentType);
	const etag = `"${file.id}-${Number(file.createdAt).toString(36)}-${Number(file.size).toString(36)}"`;
	const headers = new Headers();
	headers.set("Content-Type", inlineType ?? "application/octet-stream");
	headers.set("Content-Disposition", driveContentDisposition(file.name, inlineType !== null));
	headers.set("Accept-Ranges", "bytes");
	headers.set("ETag", etag);
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("Content-Security-Policy", inlineType === "application/pdf" ? "frame-ancestors 'self'" : "default-src 'none'; style-src 'unsafe-inline'; sandbox");
	headers.set("Referrer-Policy", "no-referrer");
	headers.set("Cache-Control", options.cache === "immutable" ? "private, max-age=604800, immutable" : "private, no-store");

	if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
	const size = Number(file.size);
	const ifRange = request.headers.get("If-Range");
	const range = ifRange && ifRange !== etag ? null : parseByteRange(request.headers.get("Range"), size);
	if (range === "invalid") {
		headers.set("Content-Range", `bytes */${size}`);
		return new Response(null, { status: 416, headers });
	}
	const object = range
		? await env.BUCKET.get(file.r2Key, { range: { offset: range.start, length: range.end - range.start + 1 } })
		: await env.BUCKET.get(file.r2Key);
	if (!object) return new Response("File not found", { status: 404 });
	if (!range) {
		headers.set("Content-Length", String(size));
		return new Response(request.method === "HEAD" ? null : object.body, { headers });
	}
	headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
	headers.set("Content-Length", String(range.end - range.start + 1));
	return new Response(request.method === "HEAD" ? null : object.body, { status: 206, headers });
}

/** Deletes stored objects, logging instead of failing: the database rows are already gone. */
export async function deleteChatObjects(env: CloudflareEnv, keys: string[]): Promise<void> {
	if (keys.length === 0) return;
	try {
		for (let index = 0; index < keys.length; index += 1000) await env.BUCKET.delete(keys.slice(index, index + 1000));
	} catch (error) {
		console.error("Deleting chat files failed", error);
	}
}
