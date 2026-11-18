"use client";

import { useEffect, useState, type ReactElement } from "react";
import clsx from "clsx";
import toast from "react-hot-toast";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Clock, Plus, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCurrentUser } from "@/hooks/use-current-user";
import { authFetch } from "@/lib/auth/client";
import type { ChatStickerDto, ChatStickerKind } from "@/lib/chat/types";
import { EMOJI_CATEGORIES, readRecentEmojis, rememberEmoji } from "./emoji-data";

const STICKER_MAX_BYTES = 5 * 1024 * 1024;
const STICKER_TYPES = "image/png,image/jpeg,image/gif,image/webp";
const panelClass = "z-[200] rounded-2xl border border-neutral-200 bg-white p-2 shadow-xl";

async function readError(response: Response, fallback: string) {
	const data = await response.json().catch(() => ({})) as { error?: string };
	return data.error || fallback;
}

/** Emoji grid in a dropdown. The trigger is any single button element. */
export function EmojiPicker({ trigger, onPick, onOpenChange: notify, side = "top", align = "start" }: { trigger: ReactElement; onPick: (emoji: string) => void; onOpenChange?: (open: boolean) => void; side?: "top" | "bottom"; align?: "start" | "end" }) {
	const { t } = useLanguage();
	const [open, setOpen] = useState(false);
	const [recent, setRecent] = useState<string[]>([]);
	const [category, setCategory] = useState("smileys");
	const onOpenChange = (value: boolean) => {
		if (value) {
			const stored = readRecentEmojis();
			setRecent(stored);
			setCategory(stored.length ? "recent" : "smileys");
		}
		setOpen(value);
		notify?.(value);
	};
	const pick = (emoji: string) => {
		rememberEmoji(emoji);
		onPick(emoji);
		onOpenChange(false);
	};
	const list = category === "recent" ? recent : EMOJI_CATEGORIES.find((item) => item.key === category)?.emojis ?? [];
	return (
		<DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
			<DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content side={side} align={align} sideOffset={8} className={clsx(panelClass, "w-[312px]")} aria-label={t("chat.emoji")}>
					<div className="mb-1 flex gap-0.5 border-b border-neutral-100 pb-1" role="tablist">
						{recent.length > 0 && (
							<button type="button" role="tab" aria-selected={category === "recent"} title={t("chat.emojiRecent")} onClick={() => setCategory("recent")} className={clsx("flex h-8 w-8 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100", category === "recent" && "bg-blue-50 text-blue-700")}>
								<Clock size={16} />
							</button>
						)}
						{EMOJI_CATEGORIES.map((item) => (
							<button key={item.key} type="button" role="tab" aria-selected={category === item.key} title={t(`chat.emojiCategory.${item.key}`)} onClick={() => setCategory(item.key)} className={clsx("flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-neutral-100", category === item.key && "bg-blue-50")}>
								{item.icon}
							</button>
						))}
					</div>
					<div className="grid max-h-60 grid-cols-8 overflow-y-auto" role="tabpanel">
						{list.map((emoji) => (
							<button key={emoji} type="button" onClick={() => pick(emoji)} className="flex h-9 w-9 items-center justify-center rounded-lg text-xl hover:bg-neutral-100" aria-label={emoji}>
								{emoji}
							</button>
						))}
					</div>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}

let stickerCache: Promise<ChatStickerDto[]> | null = null;

function loadStickers(force = false): Promise<ChatStickerDto[]> {
	if (force || !stickerCache) {
		stickerCache = authFetch("/api/chat/stickers", { redirectOnUnauthorized: false })
			.then(async (response) => response.ok ? (await response.json() as { stickers: ChatStickerDto[] }).stickers : [])
			.catch(() => []);
	}
	return stickerCache;
}

/** The organization's shared stickers and GIFs; anyone can add more. */
export function StickerPicker({ trigger, onPick }: { trigger: ReactElement; onPick: (sticker: ChatStickerDto) => void }) {
	const { t } = useLanguage();
	const user = useCurrentUser();
	const [open, setOpen] = useState(false);
	const [kind, setKind] = useState<ChatStickerKind>("sticker");
	const [stickers, setStickers] = useState<ChatStickerDto[] | null>(null);
	const [adding, setAdding] = useState(false);
	const onOpenChange = (value: boolean) => {
		if (value) void loadStickers().then(setStickers);
		setOpen(value);
	};
	const remove = async (sticker: ChatStickerDto) => {
		const ok = await confirmDestructive({ title: t("chat.stickerDelete"), message: t("chat.stickerDeleteConfirm"), confirmLabel: t("chat.delete") });
		if (!ok) return;
		const response = await authFetch(`/api/chat/stickers/${encodeURIComponent(sticker.id)}`, { method: "DELETE" });
		if (!response.ok) {
			toast.error(await readError(response, t("chat.loadFailed")));
			return;
		}
		setStickers(await loadStickers(true));
	};
	const visible = (stickers ?? []).filter((sticker) => sticker.kind === kind);
	return (
		<>
			<DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
				<DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content side="top" align="start" sideOffset={8} className={clsx(panelClass, "w-[332px]")} aria-label={t("chat.stickers")}>
						<div className="mb-2 flex items-center gap-1" role="tablist">
							{(["sticker", "gif"] as const).map((value) => (
								<button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => setKind(value)} className={clsx("rounded-full px-3 py-1 text-sm font-medium", kind === value ? "bg-blue-100 text-blue-900" : "text-neutral-600 hover:bg-neutral-100")}>
									{value === "gif" ? t("chat.gifs") : t("chat.stickers")}
								</button>
							))}
							<span className="flex-1" />
							<button type="button" onClick={() => { setOpen(false); setAdding(true); }} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50">
								<Plus size={16} />{t("chat.stickerAdd")}
							</button>
						</div>
						<div className="grid max-h-72 grid-cols-4 gap-1 overflow-y-auto">
							{stickers === null ? (
								<p className="col-span-4 py-8 text-center text-sm text-neutral-500">{t("common.loading")}</p>
							) : visible.length === 0 ? (
								<p className="col-span-4 px-4 py-8 text-center text-sm text-neutral-500">{kind === "gif" ? t("chat.gifsEmpty") : t("chat.stickersEmpty")}</p>
							) : visible.map((sticker) => (
								<div key={sticker.id} className="group/sticker relative">
									<button type="button" title={sticker.name} aria-label={sticker.name} onClick={() => { setOpen(false); onPick(sticker); }} className="flex h-[74px] w-full items-center justify-center rounded-xl p-1 hover:bg-neutral-100">
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img src={sticker.url} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
									</button>
									{(sticker.createdByUserId === user?.id || user?.role === "admin") && (
										<button type="button" aria-label={t("chat.stickerDelete")} title={t("chat.stickerDelete")} onClick={() => void remove(sticker)} className="absolute right-0.5 top-0.5 hidden h-5 w-5 items-center justify-center rounded-full bg-neutral-800/80 text-white group-hover/sticker:flex focus:flex">
											<X size={12} />
										</button>
									)}
								</div>
							))}
						</div>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
			<AddStickerDialog open={adding} onOpenChange={setAdding} initialKind={kind} onAdded={(sticker) => { setKind(sticker.kind); void loadStickers(true).then(setStickers); }} />
		</>
	);
}

type AddProps = { open: boolean; onOpenChange: (open: boolean) => void; initialKind: ChatStickerKind; onAdded: (sticker: ChatStickerDto) => void };

function AddStickerDialog(props: AddProps) {
	const [busy, setBusy] = useState(false);
	return (
		<Dialog open={props.open} onOpenChange={(value) => { if (!busy) props.onOpenChange(value); }}>
			<DialogContent>
				<AddStickerForm {...props} busy={busy} setBusy={setBusy} />
			</DialogContent>
		</Dialog>
	);
}

function AddStickerForm({ onOpenChange, initialKind, onAdded, busy, setBusy }: AddProps & { busy: boolean; setBusy: (busy: boolean) => void }) {
	const { t } = useLanguage();
	const [file, setFile] = useState<File | null>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [kind, setKind] = useState<ChatStickerKind>(initialKind);
	useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

	const choose = (next: File | null) => {
		if (!next) return;
		if (next.size > STICKER_MAX_BYTES) {
			toast.error(t("chat.stickerTooLarge"));
			return;
		}
		setFile(next);
		setPreview(URL.createObjectURL(next));
		if (!name.trim()) setName(next.name.replace(/\.[^.]+$/, "").slice(0, 60));
		if (next.type === "image/gif") setKind("gif");
	};

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!file || busy) return;
		setBusy(true);
		try {
			const query = new URLSearchParams({ name: name.trim() || file.name, kind });
			const response = await authFetch(`/api/chat/stickers?${query}`, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
			if (!response.ok) throw new Error(await readError(response, t("chat.uploadFailed")));
			const { sticker } = await response.json() as { sticker: ChatStickerDto };
			onAdded(sticker);
			setBusy(false);
			onOpenChange(false);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("chat.uploadFailed"));
			setBusy(false);
		}
	};

	return (
		<form onSubmit={(event) => void submit(event)}>
			<DialogHeader>
				<DialogTitle>{t("chat.stickerAddTitle")}</DialogTitle>
				<DialogDescription>{t("chat.stickerAddHint")}</DialogDescription>
			</DialogHeader>
			<label className="mb-4 flex h-40 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 text-sm text-neutral-500 hover:border-blue-400">
				<input type="file" accept={STICKER_TYPES} className="sr-only" onChange={(event) => choose(event.target.files?.[0] ?? null)} />
				{/* eslint-disable-next-line @next/next/no-img-element */}
				{preview ? <img src={preview} alt="" className="max-h-36 max-w-full object-contain" /> : t("chat.stickerChoose")}
			</label>
			<div className="mb-4">
				<label htmlFor="chat-sticker-name" className="mb-1.5 block text-sm font-medium text-neutral-700">{t("chat.stickerName")}</label>
				<Input id="chat-sticker-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
			</div>
			<fieldset className="flex gap-4 text-sm text-neutral-700">
				<legend className="sr-only">{t("chat.stickerKind")}</legend>
				{(["sticker", "gif"] as const).map((value) => (
					<label key={value} className="flex items-center gap-2">
						<input type="radio" name="chat-sticker-kind" checked={kind === value} onChange={() => setKind(value)} />
						{value === "gif" ? t("chat.gif") : t("chat.sticker")}
					</label>
				))}
			</fieldset>
			<div className="mt-5 flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
				<Button type="submit" disabled={busy || !file}>{busy ? t("chat.uploading") : t("chat.add")}</Button>
			</div>
		</form>
	);
}
