"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import toast from "react-hot-toast";
import { File as FileIcon, Loader2, Paperclip, Send, Smile, Sticker, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { authFetch } from "@/lib/auth/client";
import type { ChatAttachmentDto, ChatStickerDto } from "@/lib/chat/types";
import { EmojiPicker, StickerPicker } from "./chat-pickers";

export const CHAT_MAX_LENGTH = 4000;
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

export type ComposerInput = { body: string; attachmentIds: string[]; stickerId?: string };

type Upload = { key: string; name: string; size: number; status: "uploading" | "done" | "error"; attachment?: ChatAttachmentDto; preview?: string };

export function formatBytes(size: number) {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
	return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const iconButton = "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-200/70 disabled:text-neutral-300 disabled:hover:bg-transparent";

/** Text box with emoji, sticker/GIF and file buttons. Files upload as soon as they are picked, then go out with the message. */
export function Composer({ conversationId, placeholder, onSend, autoFocus = true, compact = false }: {
	conversationId: string;
	placeholder: string;
	onSend: (input: ComposerInput) => Promise<boolean>;
	autoFocus?: boolean;
	compact?: boolean;
}) {
	const { t } = useLanguage();
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const [uploads, setUploads] = useState<Upload[]>([]);
	const ref = useRef<HTMLTextAreaElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const uploadsRef = useRef(uploads);
	useEffect(() => { uploadsRef.current = uploads; }, [uploads]);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.style.height = "auto";
		element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
	}, [text]);

	useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

	// Files picked but never sent are cleaned up when the composer goes away.
	useEffect(() => () => {
		for (const upload of uploadsRef.current) {
			if (upload.preview) URL.revokeObjectURL(upload.preview);
			if (upload.attachment) void authFetch(`/api/chat/attachments/${encodeURIComponent(upload.attachment.id)}`, { method: "DELETE", redirectOnUnauthorized: false }).catch(() => undefined);
		}
	}, []);

	const upload = (file: File) => {
		const key = crypto.randomUUID();
		const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
		setUploads((current) => [...current, { key, name: file.name || "file", size: file.size, status: "uploading", preview }]);
		const query = new URLSearchParams({ name: file.name || "file" });
		void authFetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/attachments?${query}`, {
			method: "PUT",
			headers: { "Content-Type": file.type || "application/octet-stream" },
			body: file,
		})
			.then(async (response) => {
				const data = await response.json().catch(() => ({})) as { attachment?: ChatAttachmentDto; error?: string };
				if (!response.ok || !data.attachment) throw new Error(data.error || t("chat.uploadFailed"));
				const attachment = data.attachment;
				setUploads((current) => current.map((item) => item.key === key ? { ...item, status: "done", attachment } : item));
			})
			.catch((error: unknown) => {
				toast.error(error instanceof Error ? error.message : t("chat.uploadFailed"));
				setUploads((current) => current.map((item) => item.key === key ? { ...item, status: "error" } : item));
			});
	};

	const addFiles = (files: Iterable<File>) => {
		let room = MAX_ATTACHMENTS - uploadsRef.current.length;
		for (const file of files) {
			if (room <= 0) {
				toast.error(t("chat.tooManyFiles", { count: MAX_ATTACHMENTS }));
				break;
			}
			if (file.size > ATTACHMENT_MAX_BYTES) {
				toast.error(t("chat.fileTooLarge", { name: file.name }));
				continue;
			}
			if (file.size === 0) continue;
			upload(file);
			room -= 1;
		}
	};

	const removeUpload = (item: Upload) => {
		if (item.preview) URL.revokeObjectURL(item.preview);
		setUploads((current) => current.filter((entry) => entry.key !== item.key));
		if (item.attachment) void authFetch(`/api/chat/attachments/${encodeURIComponent(item.attachment.id)}`, { method: "DELETE", redirectOnUnauthorized: false }).catch(() => undefined);
	};

	const busyUploading = uploads.some((item) => item.status === "uploading");
	const ready = uploads.filter((item) => item.status === "done" && item.attachment);
	const canSend = !sending && !busyUploading && (text.trim().length > 0 || ready.length > 0);

	const submit = async () => {
		if (!canSend) return;
		const body = text.trim();
		const sent = ready;
		setSending(true);
		setText("");
		const ok = await onSend({ body, attachmentIds: sent.map((item) => item.attachment!.id) });
		if (ok) {
			for (const item of sent) if (item.preview) URL.revokeObjectURL(item.preview);
			const keys = new Set(sent.map((item) => item.key));
			setUploads((current) => current.filter((item) => !keys.has(item.key)));
		} else {
			setText((current) => current || body);
		}
		setSending(false);
		ref.current?.focus();
	};

	const sendSticker = async (sticker: ChatStickerDto) => {
		if (sending) return;
		setSending(true);
		await onSend({ body: "", attachmentIds: [], stickerId: sticker.id });
		setSending(false);
		ref.current?.focus();
	};

	const insertEmoji = (emoji: string) => {
		const element = ref.current;
		if (!element) {
			setText((current) => current + emoji);
			return;
		}
		const start = element.selectionStart ?? text.length;
		const end = element.selectionEnd ?? text.length;
		const next = (text.slice(0, start) + emoji + text.slice(end)).slice(0, CHAT_MAX_LENGTH);
		setText(next);
		requestAnimationFrame(() => {
			element.focus();
			const caret = Math.min(start + emoji.length, next.length);
			element.setSelectionRange(caret, caret);
		});
	};

	return (
		<form
			className={clsx("shrink-0", compact ? "px-3 pb-3 pt-2" : "px-4 pb-4 pt-2 sm:px-5")}
			onSubmit={(event) => { event.preventDefault(); void submit(); }}
			onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
			onDrop={(event) => {
				if (!event.dataTransfer.files.length) return;
				event.preventDefault();
				addFiles(event.dataTransfer.files);
			}}
		>
			<div className="rounded-3xl border border-neutral-200 bg-neutral-50 focus-within:border-blue-400 focus-within:bg-white">
				{uploads.length > 0 && (
					<ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label={t("chat.attachments")}>
						{uploads.map((item) => (
							<li key={item.key} className={clsx("relative flex max-w-[220px] items-center gap-2 rounded-xl border bg-white py-1.5 pl-1.5 pr-8 text-xs", item.status === "error" ? "border-red-300" : "border-neutral-200")}>
								{item.preview
									// eslint-disable-next-line @next/next/no-img-element
									? <img src={item.preview} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
									: <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><FileIcon size={18} /></span>}
								<span className="min-w-0">
									<span className="block truncate font-medium text-neutral-800">{item.name}</span>
									<span className={clsx("block", item.status === "error" ? "text-red-600" : "text-neutral-500")}>
										{item.status === "uploading" ? t("chat.uploading") : item.status === "error" ? t("chat.uploadFailed") : formatBytes(item.size)}
									</span>
								</span>
								{item.status === "uploading" && <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-neutral-400" />}
								{item.status !== "uploading" && (
									<button type="button" onClick={() => removeUpload(item)} aria-label={t("chat.removeFile", { name: item.name })} title={t("chat.remove")} className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100">
										<X size={14} />
									</button>
								)}
							</li>
						))}
					</ul>
				)}
				<div className="flex items-end gap-0.5 py-1.5 pl-1.5 pr-1.5">
					<input ref={fileRef} type="file" multiple className="sr-only" tabIndex={-1} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
					<button type="button" className={iconButton} onClick={() => fileRef.current?.click()} aria-label={t("chat.attach")} title={t("chat.attach")} disabled={sending}>
						<Paperclip size={18} />
					</button>
					<textarea
						ref={ref}
						rows={1}
						value={text}
						maxLength={CHAT_MAX_LENGTH}
						onChange={(event) => setText(event.target.value)}
						onPaste={(event) => {
							const files = [...event.clipboardData.files];
							if (files.length === 0) return;
							event.preventDefault();
							addFiles(files);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
								event.preventDefault();
								void submit();
							}
						}}
						placeholder={placeholder}
						aria-label={placeholder}
						className="max-h-[200px] min-h-[36px] min-w-0 flex-1 resize-none bg-transparent px-1.5 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-500"
					/>
					<EmojiPicker
						align="end"
						onPick={insertEmoji}
						trigger={<button type="button" className={iconButton} aria-label={t("chat.emoji")} title={t("chat.emoji")}><Smile size={18} /></button>}
					/>
					<StickerPicker
						onPick={(sticker) => void sendSticker(sticker)}
						trigger={<button type="button" className={iconButton} aria-label={t("chat.stickersAndGifs")} title={t("chat.stickersAndGifs")} disabled={sending}><Sticker size={18} /></button>}
					/>
					<button type="submit" disabled={!canSend} aria-label={t("chat.send")} title={t("chat.send")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-blue-700 hover:bg-blue-50 disabled:text-neutral-400 disabled:hover:bg-transparent">
						<Send size={18} />
					</button>
				</div>
			</div>
		</form>
	);
}
