"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import toast, { Toaster } from "react-hot-toast";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LogOut, MessageCircle, MessageCirclePlus, MoreVertical, Settings, ShieldCheck, UserPlus, Users, UsersRound } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { authFetch } from "@/lib/auth/client";
import { isChatAdmin } from "@/lib/chat/permissions";
import type { ChatConversationDto, ChatMessageDto, ChatRealtimeEvent } from "@/lib/chat/types";
import { CHAT_EVENT, chatPostJson, conversationAvatarUser, conversationTitle, useChat } from "../chat-context";
import { ChatAvatar, NewDirectDialog, SpaceDialog } from "../chat-dialogs";
import { Composer, type ComposerInput } from "./composer";
import { DaySeparator, MessageRow, dayKey, isGrouped, mergeMessages, useFormatters } from "./message-item";
import { MembersDialog, SpaceSettingsDialog } from "./space-settings";
import { ThreadPanel } from "./thread-panel";

const PAGE_SIZE = 50;
const itemClass = "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-700 outline-none data-[highlighted]:bg-neutral-100";

type MessagesResponse = { messages: ChatMessageDto[]; hasMore: boolean };

function ConversationHeader({ conversation, currentUserId }: { conversation: ChatConversationDto; currentUserId?: string }) {
	const { t } = useLanguage();
	const { refresh, openConversation, upsertConversation } = useChat();
	const [addOpen, setAddOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [membersOpen, setMembersOpen] = useState(false);
	const title = conversationTitle(conversation, currentUserId, t("chat.untitled"));
	const other = conversationAvatarUser(conversation, currentUserId);
	const isSpace = conversation.type === "space";
	const admin = isSpace && isChatAdmin(conversation.role);
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

	return (
		<div className="flex h-16 shrink-0 items-center gap-3 border-b border-neutral-200 px-4 sm:px-5">
			{isSpace ? <ChatAvatar space={{ id: conversation.id, name: conversation.name }} size={36} /> : <ChatAvatar user={other} size={36} />}
			<div className="min-w-0 flex-1">
				<h1 className="truncate text-base font-semibold text-neutral-900">{title}</h1>
				<p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-neutral-500">
					{isSpace
						? <button type="button" className="hover:underline" onClick={() => setMembersOpen(true)}>{t("chat.membersCount", { count: conversation.members.length })}</button>
						: other?.email}
					{isSpace && conversation.postPolicy !== "everyone" && (
						<span className="flex items-center gap-1" title={t(conversation.postPolicy === "admins" ? "chat.policyAdminsHint" : "chat.policyAdminsThreadsHint")}>
							<span aria-hidden>·</span>
							<ShieldCheck size={12} />
							{t(conversation.postPolicy === "admins" ? "chat.policyAdmins" : "chat.policyAdminsThreads")}
						</span>
					)}
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
							{admin && <DropdownMenu.Item className={itemClass} onSelect={() => setSettingsOpen(true)}><Settings size={18} />{t("chat.spaceSettings")}</DropdownMenu.Item>}
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
					{admin && <SpaceSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} conversation={conversation} />}
					<MembersDialog open={membersOpen} onOpenChange={setMembersOpen} conversation={conversation} currentUserId={currentUserId} />
				</>
			)}
		</div>
	);
}

function PostLockedNotice({ conversation }: { conversation: ChatConversationDto }) {
	const { t } = useLanguage();
	return (
		<div className="shrink-0 px-4 pb-4 pt-2 sm:px-5">
			<p className="flex items-center justify-center gap-2 rounded-2xl bg-neutral-100 px-4 py-3 text-center text-sm text-neutral-600">
				<ShieldCheck size={16} className="shrink-0" />
				<span>{t("chat.postLocked")}{conversation.canReply && <> {t("chat.postLockedThreads")}</>}</span>
			</p>
		</div>
	);
}

function ConversationView({ conversation }: { conversation: ChatConversationDto }) {
	const { t } = useLanguage();
	const user = useCurrentUser();
	const { applyMessage, markRead } = useChat();
	const { formatDay } = useFormatters();
	const [messages, setMessages] = useState<ChatMessageDto[]>([]);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState(false);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const [threadId, setThreadId] = useState<string | null>(null);
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

	const replaceMessage = useCallback((message: ChatMessageDto) => {
		setMessages((current) => current.some((item) => item.id === message.id) ? current.map((item) => item.id === message.id ? message : item) : current);
	}, []);

	const removeMessage = useCallback((messageId: string) => {
		setMessages((current) => current.filter((item) => item.id !== messageId));
		setThreadId((current) => current === messageId ? null : current);
	}, []);

	useEffect(() => {
		const onChat = (event: Event) => {
			const detail = (event as CustomEvent<ChatRealtimeEvent>).detail;
			if (detail?.conversationId !== id) return;
			if (detail.event === "message" && detail.message) {
				// Thread replies live in the thread panel; the parent's count arrives as an update.
				if (detail.message.parentMessageId) {
					if (document.visibilityState === "visible") markRead(id);
					return;
				}
				const element = scrollRef.current;
				stickToBottom.current = !element || element.scrollHeight - element.scrollTop - element.clientHeight < 120;
				setMessages((current) => mergeMessages(current, [detail.message!]));
			} else if (detail.event === "update" && detail.message && !detail.message.parentMessageId) {
				replaceMessage(detail.message);
			} else if (detail.event === "delete" && detail.messageId && !detail.parentMessageId) {
				removeMessage(detail.messageId);
			}
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
	}, [id, fetchLatest, markRead, replaceMessage, removeMessage]);

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

	const send = async (input: ComposerInput) => {
		try {
			const { message } = await chatPostJson<{ message: ChatMessageDto }>(`${base}/messages`, input);
			stickToBottom.current = true;
			setMessages((current) => mergeMessages(current, [message]));
			applyMessage(message, true);
			return true;
		} catch (error) {
			toast.error(error instanceof Error && error.message !== "Request failed" ? error.message : t("chat.sendFailed"));
			return false;
		}
	};

	const openThread = (message: ChatMessageDto) => setThreadId((current) => current === message.id ? null : message.id);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<ConversationHeader conversation={conversation} currentUserId={user?.id} />
			<div className="relative flex min-h-0 flex-1">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-4 sm:px-3" aria-live="polite" aria-busy={loading}>
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
										return (
											<li key={message.id}>
												{newDay && <DaySeparator label={formatDay(message.sentAt)} />}
												<MessageRow
													message={message}
													conversation={conversation}
													currentUserId={user?.id}
													grouped={isGrouped(previous, message)}
													onOpenThread={openThread}
													onChange={replaceMessage}
													onRemove={(item) => removeMessage(item.id)}
												/>
											</li>
										);
									})}
								</ol>
							</>
						)}
					</div>
					{conversation.canPost
						? <Composer conversationId={id} placeholder={t("chat.messagePlaceholder", { name: title })} onSend={send} />
						: <PostLockedNotice conversation={conversation} />}
				</div>
				{threadId && (
					<div className="absolute inset-0 z-10 bg-white md:static md:z-auto md:w-[380px] md:shrink-0 md:border-l md:border-neutral-200">
						<ThreadPanel key={threadId} conversation={conversation} parentId={threadId} onClose={() => setThreadId(null)} onParentChange={replaceMessage} />
					</div>
				)}
			</div>
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
