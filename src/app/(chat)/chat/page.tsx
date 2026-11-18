"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import toast, { Toaster } from "react-hot-toast";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LogOut, MessageCircle, MessageCirclePlus, MoreVertical, Pencil, Send, UserPlus, Users, UsersRound, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { authFetch } from "@/lib/auth/client";
import type { ChatConversationDto, ChatMessageDto, ChatRealtimeEvent } from "@/lib/chat/types";
import { CHAT_EVENT, chatPostJson, conversationAvatarUser, conversationTitle, useChat } from "../chat-context";
import { ChatAvatar, NewDirectDialog, RenameSpaceDialog, SpaceDialog } from "../chat-dialogs";

const PAGE_SIZE = 50;
const MAX_LENGTH = 4000;
const GROUP_WINDOW_MS = 5 * 60_000;
const itemClass = "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-700 outline-none data-[highlighted]:bg-neutral-100";

type MessagesResponse = { messages: ChatMessageDto[]; hasMore: boolean };

function mergeMessages(current: ChatMessageDto[], incoming: ChatMessageDto[]) {
	const byId = new Map(current.map((message) => [message.id, message]));
	for (const message of incoming) byId.set(message.id, message);
	return [...byId.values()].sort((a, b) => a.sentAt - b.sentAt);
}

function dayKey(time: number) {
	const date = new Date(time);
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function useFormatters() {
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
	return { formatTime, formatDay };
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

function MembersDialog({ open, onOpenChange, conversation, currentUserId, onRemove }: { open: boolean; onOpenChange: (open: boolean) => void; conversation: ChatConversationDto; currentUserId?: string; onRemove: (userId: string) => Promise<void> }) {
	const { t } = useLanguage();
	const [busy, setBusy] = useState<string | null>(null);
	const canRemove = conversation.role === "owner";
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader><DialogTitle>{t("chat.members")}</DialogTitle></DialogHeader>
				<ul className="max-h-80 space-y-0.5 overflow-y-auto">
					{conversation.members.map((member) => (
						<li key={member.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
							<ChatAvatar user={member} size={32} />
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium text-neutral-900">{member.name}{member.id === currentUserId && <span className="font-normal text-neutral-500"> ({t("chat.you")})</span>}</span>
								<span className="block truncate text-xs text-neutral-500">{member.email}</span>
							</span>
							{canRemove && member.id !== currentUserId && (
								<Button type="button" variant="ghost" size="icon" aria-label={t("chat.remove")} title={t("chat.remove")} disabled={busy === member.id} onClick={async () => {
									setBusy(member.id);
									try { await onRemove(member.id); } catch (error) { toast.error(error instanceof Error ? error.message : t("chat.loadFailed")); } finally { setBusy(null); }
								}}>
									<X size={16} />
								</Button>
							)}
						</li>
					))}
				</ul>
			</DialogContent>
		</Dialog>
	);
}

function ConversationHeader({ conversation, currentUserId }: { conversation: ChatConversationDto; currentUserId?: string }) {
	const { t } = useLanguage();
	const { refresh, openConversation, upsertConversation } = useChat();
	const [addOpen, setAddOpen] = useState(false);
	const [renameOpen, setRenameOpen] = useState(false);
	const [membersOpen, setMembersOpen] = useState(false);
	const title = conversationTitle(conversation, currentUserId, t("chat.untitled"));
	const other = conversationAvatarUser(conversation, currentUserId);
	const isSpace = conversation.type === "space";
	const base = `/api/chat/conversations/${encodeURIComponent(conversation.id)}`;

	const leave = async () => {
		const ok = await confirmDestructive({ title: t("chat.leave"), message: t("chat.leaveConfirm"), confirmLabel: t("chat.leave") });
		if (!ok) return;
		try {
			const response = await authFetch(`${base}/members`, { method: "DELETE" });
			if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || t("chat.loadFailed"));
			openConversation(null);
			await refresh();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("chat.loadFailed"));
		}
	};

	const removeMember = async (userId: string) => {
		const response = await authFetch(`${base}/members?userId=${encodeURIComponent(userId)}`, { method: "DELETE" });
		if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || t("chat.loadFailed"));
		await refresh();
	};

	return (
		<div className="flex h-16 shrink-0 items-center gap-3 border-b border-neutral-200 px-4 sm:px-5">
			{isSpace ? <ChatAvatar space={{ id: conversation.id, name: conversation.name }} size={36} /> : <ChatAvatar user={other} size={36} />}
			<div className="min-w-0 flex-1">
				<h1 className="truncate text-base font-semibold text-neutral-900">{title}</h1>
				<p className="truncate text-xs text-neutral-500">
					{isSpace
						? <button type="button" className="hover:underline" onClick={() => setMembersOpen(true)}>{t("chat.membersCount", { count: conversation.members.length })}</button>
						: other?.email}
				</p>
			</div>
			{isSpace && (
				<DropdownMenu.Root modal={false}>
					<DropdownMenu.Trigger asChild>
						<Button type="button" variant="ghost" size="icon" aria-label={t("chat.options")} title={t("chat.options")}><MoreVertical size={18} /></Button>
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content align="end" sideOffset={6} className="z-[200] min-w-52 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl">
							<DropdownMenu.Item className={itemClass} onSelect={() => setAddOpen(true)}><UserPlus size={18} />{t("chat.addPeople")}</DropdownMenu.Item>
							<DropdownMenu.Item className={itemClass} onSelect={() => setMembersOpen(true)}><Users size={18} />{t("chat.members")}</DropdownMenu.Item>
							<DropdownMenu.Item className={itemClass} onSelect={() => setRenameOpen(true)}><Pencil size={18} />{t("chat.rename")}</DropdownMenu.Item>
							<DropdownMenu.Separator className="my-1 h-px bg-neutral-200" />
							<DropdownMenu.Item className={clsx(itemClass, "text-red-700")} onSelect={() => void leave()}><LogOut size={18} />{t("chat.leave")}</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			)}
			{isSpace && (
				<>
					<SpaceDialog
						open={addOpen}
						onOpenChange={setAddOpen}
						addTo={{ id: conversation.id, memberIds: conversation.members.map((member) => member.id) }}
						onAdd={async (userIds) => {
							const { conversation: updated } = await chatPostJson<{ conversation: ChatConversationDto }>(`${base}/members`, { userIds });
							upsertConversation(updated);
						}}
					/>
					<RenameSpaceDialog
						open={renameOpen}
						onOpenChange={setRenameOpen}
						initialName={conversation.name ?? ""}
						onSave={async (name) => {
							const { conversation: updated } = await chatPostJson<{ conversation: ChatConversationDto }>(base, { name }, "PATCH");
							upsertConversation(updated);
						}}
					/>
					<MembersDialog open={membersOpen} onOpenChange={setMembersOpen} conversation={conversation} currentUserId={currentUserId} onRemove={removeMember} />
				</>
			)}
		</div>
	);
}

function Composer({ placeholder, onSend }: { placeholder: string; onSend: (body: string) => Promise<boolean> }) {
	const { t } = useLanguage();
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.style.height = "auto";
		element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
	}, [text]);

	useEffect(() => { ref.current?.focus(); }, []);

	const submit = async () => {
		const body = text.trim();
		if (!body || sending) return;
		setSending(true);
		setText("");
		const ok = await onSend(body);
		if (!ok) setText((current) => current || body);
		setSending(false);
		ref.current?.focus();
	};

	return (
		<form className="shrink-0 px-4 pb-4 pt-2 sm:px-5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
			<div className="flex items-end gap-2 rounded-3xl border border-neutral-200 bg-neutral-50 py-1.5 pl-4 pr-1.5 focus-within:border-blue-400 focus-within:bg-white">
				<textarea
					ref={ref}
					rows={1}
					value={text}
					maxLength={MAX_LENGTH}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
							event.preventDefault();
							void submit();
						}
					}}
					placeholder={placeholder}
					aria-label={placeholder}
					className="max-h-[200px] min-h-[36px] flex-1 resize-none bg-transparent py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-500"
				/>
				<button type="submit" disabled={!text.trim() || sending} aria-label={t("chat.send")} title={t("chat.send")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-blue-700 hover:bg-blue-50 disabled:text-neutral-400 disabled:hover:bg-transparent">
					<Send size={18} />
				</button>
			</div>
		</form>
	);
}

function ConversationView({ conversation }: { conversation: ChatConversationDto }) {
	const { t } = useLanguage();
	const user = useCurrentUser();
	const { applyMessage, markRead } = useChat();
	const { formatTime, formatDay } = useFormatters();
	const [messages, setMessages] = useState<ChatMessageDto[]>([]);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState(false);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);
	const restoreFrom = useRef<number | null>(null);
	const id = conversation.id;
	const base = `/api/chat/conversations/${encodeURIComponent(id)}`;
	const title = conversationTitle(conversation, user?.id, t("chat.untitled"));

	const fetchLatest = useCallback(async () => {
		const response = await authFetch(`${base}/messages?limit=${PAGE_SIZE}`, { redirectOnUnauthorized: false });
		if (!response.ok) throw new Error("load");
		return await response.json() as MessagesResponse;
	}, [base]);

	useEffect(() => {
		// The view is keyed by conversation, so this runs once per conversation with fresh state.
		let cancelled = false;
		fetchLatest()
			.then((data) => { if (!cancelled) { setMessages(data.messages); setHasMore(data.hasMore); } })
			.catch(() => { if (!cancelled) setFailed(true); })
			.finally(() => { if (!cancelled) setLoading(false); });
		return () => { cancelled = true; };
	}, [fetchLatest]);

	// Opening the conversation, or seeing a new message in it, marks it read.
	const lastId = messages.at(-1)?.id;
	useEffect(() => {
		if (document.visibilityState === "visible") markRead(id);
	}, [id, lastId, markRead]);

	useEffect(() => {
		const onChat = (event: Event) => {
			const detail = (event as CustomEvent<ChatRealtimeEvent>).detail;
			if (detail?.conversationId !== id || detail.event !== "message" || !detail.message) return;
			const element = scrollRef.current;
			stickToBottom.current = !element || element.scrollHeight - element.scrollTop - element.clientHeight < 120;
			setMessages((current) => mergeMessages(current, [detail.message!]));
		};
		// After the tab was hidden (or the socket dropped) catch up on anything missed.
		const onVisible = () => {
			if (document.visibilityState !== "visible") return;
			markRead(id);
			void fetchLatest().then((data) => setMessages((current) => mergeMessages(current, data.messages))).catch(() => undefined);
		};
		window.addEventListener(CHAT_EVENT, onChat);
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			window.removeEventListener(CHAT_EVENT, onChat);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [id, fetchLatest, markRead]);

	useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		if (restoreFrom.current !== null) {
			element.scrollTop = element.scrollHeight - restoreFrom.current;
			restoreFrom.current = null;
		} else if (stickToBottom.current) {
			element.scrollTop = element.scrollHeight;
		}
	}, [messages]);

	const loadOlder = async () => {
		const oldest = messages[0];
		if (!oldest || loadingOlder) return;
		setLoadingOlder(true);
		try {
			const response = await authFetch(`${base}/messages?limit=${PAGE_SIZE}&before=${oldest.sentAt}`, { redirectOnUnauthorized: false });
			if (!response.ok) throw new Error("load");
			const data = await response.json() as MessagesResponse;
			const element = scrollRef.current;
			restoreFrom.current = element ? element.scrollHeight - element.scrollTop : null;
			stickToBottom.current = false;
			setMessages((current) => mergeMessages(current, data.messages));
			setHasMore(data.hasMore);
		} catch {
			toast.error(t("chat.loadFailed"));
		} finally {
			setLoadingOlder(false);
		}
	};

	const send = async (body: string) => {
		try {
			const { message } = await chatPostJson<{ message: ChatMessageDto }>(`${base}/messages`, { body });
			stickToBottom.current = true;
			setMessages((current) => mergeMessages(current, [message]));
			applyMessage(message, true);
			return true;
		} catch (error) {
			toast.error(error instanceof Error && error.message !== "Request failed" ? error.message : t("chat.sendFailed"));
			return false;
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<ConversationHeader conversation={conversation} currentUserId={user?.id} />
			<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5" aria-live="polite" aria-busy={loading}>
				{loading ? (
					<p className="py-10 text-center text-sm text-neutral-500">{t("common.loading")}</p>
				) : failed ? (
					<p className="py-10 text-center text-sm text-neutral-500">{t("chat.loadFailed")}</p>
				) : messages.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-3 text-center">
						{conversation.type === "space" ? <ChatAvatar space={{ id: conversation.id, name: conversation.name }} size={64} /> : <ChatAvatar user={conversationAvatarUser(conversation, user?.id)} size={64} />}
						<p className="text-base font-medium text-neutral-900">{title}</p>
						<p className="text-sm text-neutral-500">{t("chat.noMessages")}</p>
					</div>
				) : (
					<>
						{hasMore && (
							<div className="mb-3 flex justify-center">
								<Button type="button" variant="outline" size="sm" onClick={() => void loadOlder()} disabled={loadingOlder}>{loadingOlder ? t("common.loading") : t("chat.loadOlder")}</Button>
							</div>
						)}
						<ol className="space-y-0.5">
							{messages.map((message, index) => {
								const previous = messages[index - 1];
								const newDay = !previous || dayKey(previous.sentAt) !== dayKey(message.sentAt);
								const grouped = !newDay && previous?.senderUserId === message.senderUserId && message.sentAt - previous.sentAt < GROUP_WINDOW_MS;
								const mine = message.senderUserId === user?.id;
								const sender = conversation.members.find((member) => member.id === message.senderUserId);
								const name = mine ? t("chat.you") : sender?.name || message.senderName || t("chat.formerMember");
								return (
									<li key={message.id}>
										{newDay && (
											<div className="my-4 flex items-center gap-3 text-xs font-medium text-neutral-500" role="separator">
												<span className="h-px flex-1 bg-neutral-200" />
												<span>{formatDay(message.sentAt)}</span>
												<span className="h-px flex-1 bg-neutral-200" />
											</div>
										)}
										<div className={clsx("group flex gap-3 rounded-lg px-2 hover:bg-neutral-50", grouped ? "py-0.5" : "mt-2 pt-1.5 pb-0.5")}>
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
												<p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-800" title={grouped ? formatTime(message.sentAt) : undefined}>
													<MessageBody body={message.body} />
												</p>
											</div>
										</div>
									</li>
								);
							})}
						</ol>
					</>
				)}
			</div>
			<Composer placeholder={t("chat.messagePlaceholder", { name: title })} onSend={send} />
		</div>
	);
}

function EmptyState() {
	const { t } = useLanguage();
	const { conversations, loaded } = useChat();
	const [directOpen, setDirectOpen] = useState(false);
	const [spaceOpen, setSpaceOpen] = useState(false);
	if (!loaded) return <p className="py-10 text-center text-sm text-neutral-500">{t("common.loading")}</p>;
	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
			<span className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-700"><MessageCircle size={32} /></span>
			<div>
				<p className="text-lg font-medium text-neutral-900">{conversations.length ? t("chat.selectConversation") : t("chat.empty")}</p>
				{!conversations.length && <p className="mt-1 max-w-sm text-sm text-neutral-500">{t("chat.emptyHint")}</p>}
			</div>
			<div className="flex flex-wrap justify-center gap-2">
				<Button type="button" onClick={() => setDirectOpen(true)}><MessageCirclePlus size={18} />{t("chat.newDirect")}</Button>
				<Button type="button" variant="outline" onClick={() => setSpaceOpen(true)}><UsersRound size={18} />{t("chat.newSpace")}</Button>
			</div>
			<NewDirectDialog open={directOpen} onOpenChange={setDirectOpen} />
			<SpaceDialog open={spaceOpen} onOpenChange={setSpaceOpen} />
		</div>
	);
}

export default function ChatPage() {
	const { t } = useLanguage();
	const { conversations, activeId, unavailable, loaded } = useChat();
	const active = activeId ? conversations.find((item) => item.id === activeId) : undefined;
	return (
		<div className="h-full min-h-0 overflow-hidden bg-white md:rounded-2xl">
			<Toaster position="bottom-center" />
			{unavailable ? (
				<div className="flex h-full items-center justify-center px-6 text-center text-sm text-neutral-600">{t("chat.unavailable")}</div>
			) : active ? (
				<ConversationView key={active.id} conversation={active} />
			) : activeId && !loaded ? (
				<p className="py-10 text-center text-sm text-neutral-500">{t("common.loading")}</p>
			) : (
				<EmptyState />
			)}
		</div>
	);
}
