"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { useCurrentUser } from "@/hooks/use-current-user";
import { authFetch } from "@/lib/auth/client";
import type { ChatConversationDto, ChatMessageDto, ChatRealtimeEvent } from "@/lib/chat/types";
import { CHAT_EVENT, chatPostJson, conversationTitle } from "../chat-context";
import { Composer, type ComposerInput } from "./composer";
import { isGrouped, mergeMessages, MessageRow } from "./message-item";

type RepliesResponse = { parent: ChatMessageDto; replies: ChatMessageDto[] };

/** Replies to one message, beside the conversation (over it on small screens). */
export function ThreadPanel({ conversation, parentId, onClose, onParentChange }: {
	conversation: ChatConversationDto;
	parentId: string;
	onClose: () => void;
	/** Keeps the reply count in the main list in step. */
	onParentChange: (message: ChatMessageDto) => void;
}) {
	const { t } = useLanguage();
	const user = useCurrentUser();
	const [parent, setParent] = useState<ChatMessageDto | null>(null);
	const [replies, setReplies] = useState<ChatMessageDto[]>([]);
	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);
	const url = `/api/chat/messages/${encodeURIComponent(parentId)}/replies`;

	const fetchThread = useCallback(async () => {
		const response = await authFetch(url, { redirectOnUnauthorized: false });
		if (!response.ok) throw new Error("load");
		return await response.json() as RepliesResponse;
	}, [url]);

	useEffect(() => {
		// The panel is keyed by the parent message, so this runs once per thread with fresh state.
		let cancelled = false;
		fetchThread()
			.then((data) => { if (!cancelled) { setParent(data.parent); setReplies(data.replies); } })
			.catch(() => { if (!cancelled) setFailed(true); })
			.finally(() => { if (!cancelled) setLoading(false); });
		return () => { cancelled = true; };
	}, [fetchThread]);

	useEffect(() => {
		const onChat = (event: Event) => {
			const detail = (event as CustomEvent<ChatRealtimeEvent>).detail;
			if (detail?.conversationId !== conversation.id) return;
			const element = scrollRef.current;
			stickToBottom.current = !element || element.scrollHeight - element.scrollTop - element.clientHeight < 120;
			if (detail.event === "message" && detail.message?.parentMessageId === parentId) {
				setReplies((current) => mergeMessages(current, [detail.message!]));
			} else if (detail.event === "update" && detail.message) {
				if (detail.message.id === parentId) setParent(detail.message);
				else if (detail.message.parentMessageId === parentId) setReplies((current) => current.map((item) => item.id === detail.message!.id ? detail.message! : item));
			} else if (detail.event === "delete") {
				if (detail.messageId === parentId) onClose();
				else if (detail.parentMessageId === parentId) setReplies((current) => current.filter((item) => item.id !== detail.messageId));
			}
		};
		const onVisible = () => {
			if (document.visibilityState !== "visible") return;
			void fetchThread().then((data) => { setParent(data.parent); setReplies(data.replies); }).catch(() => undefined);
		};
		window.addEventListener(CHAT_EVENT, onChat);
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			window.removeEventListener(CHAT_EVENT, onChat);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [conversation.id, parentId, fetchThread, onClose]);

	useLayoutEffect(() => {
		const element = scrollRef.current;
		if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
	}, [replies, parent]);

	const syncParent = (next: ChatMessageDto, count: number) => {
		const updated = { ...next, replyCount: count };
		setParent(updated);
		onParentChange(updated);
	};

	const send = async (input: ComposerInput) => {
		try {
			const { message } = await chatPostJson<{ message: ChatMessageDto }>(`/api/chat/conversations/${encodeURIComponent(conversation.id)}/messages`, { ...input, parentMessageId: parentId });
			stickToBottom.current = true;
			const next = mergeMessages(replies, [message]);
			setReplies(next);
			if (parent) syncParent({ ...parent, lastReplyAt: Math.max(parent.lastReplyAt ?? 0, message.sentAt) }, Math.max(parent.replyCount, next.length));
			return true;
		} catch (error) {
			toast.error(error instanceof Error && error.message !== "Request failed" ? error.message : t("chat.sendFailed"));
			return false;
		}
	};

	const title = conversationTitle(conversation, user?.id, t("chat.untitled"));

	return (
		<aside className="flex h-full min-h-0 flex-col bg-white" aria-label={t("chat.thread")}>
			<div className="flex h-16 shrink-0 items-center gap-3 border-b border-neutral-200 px-4">
				<div className="min-w-0 flex-1">
					<h2 className="text-base font-semibold text-neutral-900">{t("chat.thread")}</h2>
					<p className="truncate text-xs text-neutral-500">{title}</p>
				</div>
				<button type="button" onClick={onClose} aria-label={t("chat.closeThread")} title={t("chat.closeThread")} className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100">
					<X size={18} />
				</button>
			</div>
			<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-live="polite" aria-busy={loading}>
				{loading ? (
					<p className="py-10 text-center text-sm text-neutral-500">{t("common.loading")}</p>
				) : failed || !parent ? (
					<p className="py-10 text-center text-sm text-neutral-500">{t("chat.loadFailed")}</p>
				) : (
					<>
						<MessageRow
							message={parent}
							conversation={conversation}
							currentUserId={user?.id}
							grouped={false}
							onChange={(message) => syncParent(message, message.replyCount)}
							onRemove={onClose}
						/>
						<div className="my-3 flex items-center gap-3 px-2 text-xs font-medium text-neutral-500">
							<span>{replies.length ? t("chat.replies", { count: replies.length }) : t("chat.noReplies")}</span>
							<span className="h-px flex-1 bg-neutral-200" />
						</div>
						<ol className="space-y-0.5">
							{replies.map((reply, index) => (
								<li key={reply.id}>
									<MessageRow
										message={reply}
										conversation={conversation}
										currentUserId={user?.id}
										grouped={isGrouped(replies[index - 1], reply)}
										onChange={(message) => setReplies((current) => current.map((item) => item.id === message.id ? message : item))}
										onRemove={(message) => {
											const next = replies.filter((item) => item.id !== message.id);
											setReplies(next);
											syncParent(parent, next.length);
										}}
									/>
								</li>
							))}
						</ol>
					</>
				)}
			</div>
			{conversation.canReply ? (
				parent && <Composer key={parentId} conversationId={conversation.id} placeholder={t("chat.replyPlaceholder")} onSend={send} compact />
			) : (
				<p className="shrink-0 border-t border-neutral-200 px-4 py-3 text-center text-sm text-neutral-500">{t("chat.repliesLocked")}</p>
			)}
		</aside>
	);
}
