"use client";

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import toast from "react-hot-toast";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Download, File as FileIcon, MessageThread, MoreHorizontal, Pencil, Smile, Trash2 } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { authFetch } from "@/lib/auth/client";
import { isChatAdmin } from "@/lib/chat/permissions";
import type { ChatAttachmentDto, ChatConversationDto, ChatMessageDto } from "@/lib/chat/types";
import { chatPostJson } from "../chat-context";
import { ChatAvatar } from "../chat-dialogs";
import { CHAT_MAX_LENGTH, formatBytes } from "./composer";
import { EmojiPicker } from "./chat-pickers";
import { QUICK_REACTIONS, rememberEmoji } from "./emoji-data";

export const GROUP_WINDOW_MS = 5 * 60_000;
const itemClass = "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-700 outline-none data-[highlighted]:bg-neutral-100";
const toolButton = "flex h-8 w-8 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100";

export function mergeMessages(current: ChatMessageDto[], incoming: ChatMessageDto[]) {
	const byId = new Map(current.map((message) => [message.id, message]));
	for (const message of incoming) byId.set(message.id, message);
	return [...byId.values()].sort((a, b) => a.sentAt - b.sentAt);
}

export function dayKey(time: number) {
	const date = new Date(time);
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function useFormatters() {
	const { t, locale } = useLanguage();
	const formatTime = (time: number) => new Date(time).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
	const formatDay = (time: number) => {
		const today = new Date();
		const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
		if (dayKey(time) === dayKey(today.getTime())) return t("chat.today");
		if (dayKey(time) === dayKey(yesterday.getTime())) return t("chat.yesterday");
		const date = new Date(time);
		return date.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
	};
	const formatStamp = (time: number) => dayKey(time) === dayKey(Date.now()) ? formatTime(time) : `${formatDay(time)}, ${formatTime(time)}`;
	return { formatTime, formatDay, formatStamp };
}

/** Whether a message continues the previous one from the same person (no repeated avatar and name). */
export function isGrouped(previous: ChatMessageDto | undefined, message: ChatMessageDto) {
	return !!previous && dayKey(previous.sentAt) === dayKey(message.sentAt) && previous.senderUserId === message.senderUserId && message.sentAt - previous.sentAt < GROUP_WINDOW_MS && !previous.sticker && !message.sticker;
}

export function DaySeparator({ label }: { label: string }) {
	return (
		<div className="my-4 flex items-center gap-3 text-xs font-medium text-neutral-500" role="separator">
			<span className="h-px flex-1 bg-neutral-200" />
			<span>{label}</span>
			<span className="h-px flex-1 bg-neutral-200" />
		</div>
	);
}

/** Makes plain links in a message clickable; everything else stays plain text. */
function MessageBody({ body }: { body: string }) {
	const parts = body.split(/(https?:\/\/[^\s<>"]+)/g);
	return (
		<>
			{parts.map((part, index) => index % 2 === 1
				? <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-blue-700 underline underline-offset-2">{part}</a>
				: <Fragment key={index}>{part}</Fragment>)}
		</>
	);
}

function Attachments({ attachments }: { attachments: ChatAttachmentDto[] }) {
	const { t } = useLanguage();
	const images = attachments.filter((item) => item.image);
	const files = attachments.filter((item) => !item.image);
	return (
		<div className="mt-1.5 space-y-2">
			{images.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{images.map((item) => (
						<a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" title={item.name} className="block overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src={item.url} alt={item.name} loading="lazy" className={clsx("block object-cover", images.length === 1 ? "max-h-72 max-w-full sm:max-w-sm" : "h-36 w-36")} />
						</a>
					))}
				</div>
			)}
			{files.map((item) => (
				<div key={item.id} className="flex max-w-sm items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2">
					<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><FileIcon size={20} /></span>
					<a href={item.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1">
						<span className="block truncate text-sm font-medium text-neutral-900 hover:underline">{item.name}</span>
						<span className="block text-xs text-neutral-500">{formatBytes(item.size)}</span>
					</a>
					<a href={`${item.url}?download=1`} download={item.name} aria-label={t("chat.downloadFile", { name: item.name })} title={t("chat.download")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100">
						<Download size={18} />
					</a>
				</div>
			))}
		</div>
	);
}

function EditBox({ initial, onCancel, onSave }: { initial: string; onCancel: () => void; onSave: (body: string) => Promise<void> }) {
	const { t } = useLanguage();
	const [text, setText] = useState(initial);
	const [busy, setBusy] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.style.height = "auto";
		element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
	}, [text]);
	const save = async () => {
		if (busy) return;
		if (text.trim() === initial.trim()) {
			onCancel();
			return;
		}
		setBusy(true);
		try {
			await onSave(text);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("chat.loadFailed"));
			setBusy(false);
		}
	};
	return (
		<div className="mt-1 rounded-2xl border border-blue-400 bg-white p-2">
			<textarea
				ref={ref}
				autoFocus
				rows={1}
				value={text}
				maxLength={CHAT_MAX_LENGTH}
				aria-label={t("chat.edit")}
				onChange={(event) => setText(event.target.value)}
				onFocus={(event) => event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
				onKeyDown={(event) => {
					if (event.key === "Escape") { event.preventDefault(); onCancel(); }
					if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void save(); }
				}}
				className="w-full resize-none bg-transparent px-1 text-sm text-neutral-900 outline-none"
			/>
			<div className="mt-1 flex items-center justify-end gap-2 text-xs">
				<span className="mr-auto text-neutral-500">{t("chat.editHint")}</span>
				<button type="button" onClick={onCancel} disabled={busy} className="rounded-full px-3 py-1 font-medium text-neutral-700 hover:bg-neutral-100">{t("common.cancel")}</button>
				<button type="button" onClick={() => void save()} disabled={busy} className="rounded-full bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-700 disabled:opacity-60">{t("common.save")}</button>
			</div>
		</div>
	);
}

type RowProps = {
	message: ChatMessageDto;
	conversation: ChatConversationDto;
	currentUserId?: string;
	grouped: boolean;
	/** Opens the thread; omitted inside the thread panel. */
	onOpenThread?: (message: ChatMessageDto) => void;
	onChange: (message: ChatMessageDto) => void;
	onRemove: (message: ChatMessageDto) => void;
};

export function MessageRow({ message, conversation, currentUserId, grouped, onOpenThread, onChange, onRemove }: RowProps) {
	const { t } = useLanguage();
	const { formatTime, formatStamp } = useFormatters();
	const [editing, setEditing] = useState(false);
	const [toolsOpen, setToolsOpen] = useState(false);
	const [touched, setTouched] = useState(false);
	const mine = !!currentUserId && message.senderUserId === currentUserId;
	const moderator = conversation.type === "space" && isChatAdmin(conversation.role);
	const canDelete = mine || moderator;
	const canEdit = mine && !message.sticker;
	const canThread = !!onOpenThread && !message.parentMessageId && (conversation.canReply || message.replyCount > 0);
	const sender = conversation.members.find((member) => member.id === message.senderUserId);
	const name = mine ? t("chat.you") : sender?.name || message.senderName || t("chat.formerMember");
	const memberName = (id: string) => id === currentUserId ? t("chat.you") : conversation.members.find((member) => member.id === id)?.name ?? t("chat.formerMember");
	const url = `/api/chat/messages/${encodeURIComponent(message.id)}`;

	const react = (emoji: string) => {
		rememberEmoji(emoji);
		void chatPostJson<{ message: ChatMessageDto }>(`${url}/reactions`, { emoji })
			.then((data) => onChange(data.message))
			.catch((error: unknown) => toast.error(error instanceof Error ? error.message : t("chat.loadFailed")));
	};

	const remove = async () => {
		const ok = await confirmDestructive({
			title: t("chat.deleteMessage"),
			message: message.replyCount > 0 ? t("chat.deleteMessageThreadConfirm") : t("chat.deleteMessageConfirm"),
			confirmLabel: t("chat.delete"),
		});
		if (!ok) return;
		const response = await authFetch(url, { method: "DELETE" });
		if (!response.ok) {
			const data = await response.json().catch(() => ({})) as { error?: string };
			toast.error(data.error || t("chat.loadFailed"));
			return;
		}
		onRemove(message);
	};

	const toolsVisible = toolsOpen || touched;

	return (
		<div
			className={clsx("group relative flex gap-3 rounded-lg px-2 hover:bg-neutral-50", grouped ? "py-0.5" : "mt-2 pb-0.5 pt-1.5", toolsVisible && "bg-neutral-50")}
			onClick={(event) => {
				if (!window.matchMedia("(hover: none)").matches) return;
				if ((event.target as HTMLElement).closest("a,button,textarea,input")) return;
				setTouched((value) => !value);
			}}
			onMouseLeave={() => setTouched(false)}
		>
			<div className="w-9 shrink-0">
				{!grouped && <ChatAvatar user={sender ?? { id: message.senderUserId ?? message.id, name: message.senderName ?? "?", avatarUrl: null }} size={36} />}
			</div>
			<div className="min-w-0 flex-1">
				{!grouped && (
					<p className="flex items-baseline gap-2">
						<span className="text-sm font-semibold text-neutral-900">{name}</span>
						<time dateTime={new Date(message.sentAt).toISOString()} className="text-xs text-neutral-500">{formatTime(message.sentAt)}</time>
					</p>
				)}
				{editing ? (
					<EditBox
						initial={message.body}
						onCancel={() => setEditing(false)}
						onSave={async (body) => {
							const data = await chatPostJson<{ message: ChatMessageDto }>(url, { body }, "PATCH");
							onChange(data.message);
							setEditing(false);
						}}
					/>
				) : (
					<>
						{message.body && (
							<p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-800" title={grouped ? formatStamp(message.sentAt) : undefined}>
								<MessageBody body={message.body} />
								{message.editedAt && <span className="ml-1 text-xs text-neutral-500" title={formatStamp(message.editedAt)}>({t("chat.edited")})</span>}
							</p>
						)}
						{message.sticker && (
							// eslint-disable-next-line @next/next/no-img-element
							<img src={message.sticker.url} alt={message.sticker.name} title={message.sticker.name} loading="lazy" className={clsx("mt-1 block object-contain", message.sticker.kind === "gif" ? "max-h-56 max-w-full rounded-xl sm:max-w-xs" : "h-32 w-32")} />
						)}
						{message.attachments.length > 0 && <Attachments attachments={message.attachments} />}
					</>
				)}
				{message.reactions.length > 0 && (
					<div className="mt-1.5 flex flex-wrap gap-1">
						{message.reactions.map((reaction) => {
							const reacted = !!currentUserId && reaction.userIds.includes(currentUserId);
							const who = reaction.userIds.map(memberName).join(", ");
							return (
								<button
									key={reaction.emoji}
									type="button"
									onClick={() => react(reaction.emoji)}
									aria-pressed={reacted}
									title={who}
									aria-label={t("chat.reactionLabel", { emoji: reaction.emoji, count: reaction.count, names: who })}
									className={clsx("flex h-7 items-center gap-1 rounded-full border px-2 text-sm", reacted ? "border-blue-300 bg-blue-50 text-blue-800" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300")}
								>
									<span>{reaction.emoji}</span>
									<span className="text-xs font-medium">{reaction.count}</span>
								</button>
							);
						})}
						<EmojiPicker
							side="bottom"
							onPick={react}
							trigger={<button type="button" aria-label={t("chat.addReaction")} title={t("chat.addReaction")} className="flex h-7 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300"><Smile size={14} /></button>}
						/>
					</div>
				)}
				{onOpenThread && message.replyCount > 0 && (
					<button type="button" onClick={() => onOpenThread(message)} className="mt-1 flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">
						<MessageThread size={16} />
						{t("chat.replies", { count: message.replyCount })}
						{message.lastReplyAt && <span className="font-normal text-neutral-500">{t("chat.lastReply", { time: formatStamp(message.lastReplyAt) })}</span>}
					</button>
				)}
			</div>
			{!editing && (
				<div
					className={clsx("absolute -top-4 right-2 z-10 items-center gap-0.5 rounded-xl border border-neutral-200 bg-white p-0.5 shadow-sm group-hover:flex group-focus-within:flex", toolsVisible ? "flex" : "hidden")}
					role="toolbar"
					aria-label={t("chat.messageActions")}
				>
					{QUICK_REACTIONS.slice(0, 3).map((emoji) => (
						<button key={emoji} type="button" className={clsx(toolButton, "text-base")} onClick={() => react(emoji)} aria-label={t("chat.reactWith", { emoji })} title={t("chat.reactWith", { emoji })}>{emoji}</button>
					))}
					<EmojiPicker
						align="end"
						onPick={react}
						onOpenChange={setToolsOpen}
						trigger={<button type="button" className={toolButton} aria-label={t("chat.addReaction")} title={t("chat.addReaction")}><Smile size={16} /></button>}
					/>
					{canThread && (
						<button type="button" className={toolButton} onClick={() => onOpenThread!(message)} aria-label={t("chat.replyInThread")} title={t("chat.replyInThread")}>
							<MessageThread size={16} />
						</button>
					)}
					{(canEdit || canDelete) && (
						<DropdownMenu.Root modal={false} onOpenChange={setToolsOpen}>
							<DropdownMenu.Trigger asChild>
								<button type="button" className={toolButton} aria-label={t("chat.moreActions")} title={t("chat.moreActions")}><MoreHorizontal size={16} /></button>
							</DropdownMenu.Trigger>
							<DropdownMenu.Portal>
								<DropdownMenu.Content align="end" sideOffset={6} className="z-[200] min-w-44 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl">
									{canEdit && <DropdownMenu.Item className={itemClass} onSelect={() => setEditing(true)}><Pencil size={16} />{t("chat.edit")}</DropdownMenu.Item>}
									{canDelete && <DropdownMenu.Item className={clsx(itemClass, "text-red-700")} onSelect={() => void remove()}><Trash2 size={16} />{t("chat.delete")}</DropdownMenu.Item>}
								</DropdownMenu.Content>
							</DropdownMenu.Portal>
						</DropdownMenu.Root>
					)}
				</div>
			)}
		</div>
	);
}
