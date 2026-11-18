"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { authFetch } from "@/lib/auth/client";
import type { ChatConversationDto, ChatMessageDto, ChatRealtimeEvent, ChatUserDto } from "@/lib/chat/types";

export const CHAT_EVENT = "mailflare:chat";

type ChatState = {
	conversations: ChatConversationDto[];
	loaded: boolean;
	unavailable: boolean;
	activeId: string | null;
	openConversation: (id: string | null) => void;
	refresh: () => Promise<void>;
	upsertConversation: (conversation: ChatConversationDto) => void;
	applyMessage: (message: ChatMessageDto, mine: boolean) => void;
	markRead: (id: string) => void;
	loadDirectory: () => Promise<ChatUserDto[]>;
	createDirect: (userId: string) => Promise<ChatConversationDto>;
	createSpace: (name: string, userIds: string[]) => Promise<ChatConversationDto>;
};

const ChatContext = createContext<ChatState | null>(null);

export function useChat() {
	const value = useContext(ChatContext);
	if (!value) throw new Error("useChat must be used inside ChatProvider");
	return value;
}

async function postJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
	const response = await authFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
	const data = await response.json().catch(() => ({})) as T & { error?: string };
	if (!response.ok) throw new Error(data.error || "Request failed");
	return data;
}

export { postJson as chatPostJson };

function sortConversations(list: ChatConversationDto[]) {
	return [...list].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export function ChatProvider({ children }: { children: ReactNode }) {
	const router = useRouter();
	const pathname = usePathname();
	const params = useSearchParams();
	const activeId = pathname === "/chat" ? params.get("c") : null;
	const [conversations, setConversations] = useState<ChatConversationDto[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [unavailable, setUnavailable] = useState(false);
	const directoryRef = useRef<Promise<ChatUserDto[]> | null>(null);
	const activeRef = useRef(activeId);
	const conversationsRef = useRef(conversations);
	useEffect(() => { activeRef.current = activeId; }, [activeId]);
	useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

	const refresh = useCallback(() => authFetch("/api/chat/conversations", { redirectOnUnauthorized: false })
		.then(async (response) => {
			if (!response.ok) return;
			const data = await response.json() as { conversations: ChatConversationDto[]; unavailable?: boolean };
			setConversations(sortConversations(data.conversations));
			setUnavailable(!!data.unavailable);
		})
		.catch(() => { /* keep what we have; the next event or focus retries */ })
		.finally(() => setLoaded(true)), []);

	const openConversation = useCallback((id: string | null) => {
		router.push(id ? `/chat?c=${encodeURIComponent(id)}` : "/chat");
	}, [router]);

	const upsertConversation = useCallback((conversation: ChatConversationDto) => {
		setConversations((list) => sortConversations([conversation, ...list.filter((item) => item.id !== conversation.id)]));
	}, []);

	const applyMessage = useCallback((message: ChatMessageDto, mine: boolean) => {
		setConversations((list) => {
			const current = list.find((item) => item.id === message.conversationId);
			if (!current) return list;
			if (current.lastMessage && current.lastMessage.sentAt >= message.sentAt && current.lastMessage.id !== message.id) return list;
			const reading = mine || (activeRef.current === message.conversationId && document.visibilityState === "visible");
			const alreadyCounted = current.lastMessage?.id === message.id;
			return sortConversations(list.map((item) => item.id === message.conversationId ? {
				...item,
				lastMessage: message,
				lastMessageAt: Math.max(item.lastMessageAt, message.sentAt),
				unreadCount: reading ? 0 : item.unreadCount + (alreadyCounted ? 0 : 1),
			} : item));
		});
	}, []);

	const markRead = useCallback((id: string) => {
		setConversations((list) => list.map((item) => item.id === id && item.unreadCount ? { ...item, unreadCount: 0 } : item));
		void authFetch(`/api/chat/conversations/${encodeURIComponent(id)}/read`, { method: "POST", redirectOnUnauthorized: false }).catch(() => undefined);
	}, []);

	const loadDirectory = useCallback(() => {
		directoryRef.current ??= authFetch("/api/chat/users", { redirectOnUnauthorized: false })
			.then(async (response) => response.ok ? (await response.json() as { users: ChatUserDto[] }).users : [])
			.catch(() => [])
			.then((users) => {
				if (users.length === 0) directoryRef.current = null;
				return users;
			});
		return directoryRef.current;
	}, []);

	const createDirect = useCallback(async (userId: string) => {
		const { conversation } = await postJson<{ conversation: ChatConversationDto }>("/api/chat/conversations", { type: "direct", userId });
		upsertConversation(conversation);
		return conversation;
	}, [upsertConversation]);

	const createSpace = useCallback(async (name: string, userIds: string[]) => {
		const { conversation } = await postJson<{ conversation: ChatConversationDto }>("/api/chat/conversations", { type: "space", name, userIds });
		upsertConversation(conversation);
		return conversation;
	}, [upsertConversation]);

	useEffect(() => { void refresh(); }, [refresh]);

	// Live updates arrive through the shared realtime socket (use-message-polling) as window events.
	useEffect(() => {
		const onChat = (event: Event) => {
			const detail = (event as CustomEvent<ChatRealtimeEvent>).detail;
			if (!detail?.conversationId) return;
			if (detail.event === "message" && detail.message) {
				if (conversationsRef.current.some((item) => item.id === detail.conversationId)) applyMessage(detail.message, false);
				else void refresh();
			} else if (detail.event === "read") {
				setConversations((list) => list.map((item) => item.id === detail.conversationId ? { ...item, unreadCount: 0 } : item));
			} else {
				void refresh();
			}
		};
		window.addEventListener(CHAT_EVENT, onChat);
		return () => window.removeEventListener(CHAT_EVENT, onChat);
	}, [applyMessage, refresh]);

	// Catch up after the tab was hidden or the socket dropped, and poll slowly as a fallback.
	useEffect(() => {
		const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
		document.addEventListener("visibilitychange", onVisible);
		const timer = window.setInterval(onVisible, 60_000);
		return () => {
			document.removeEventListener("visibilitychange", onVisible);
			window.clearInterval(timer);
		};
	}, [refresh]);

	const value = useMemo<ChatState>(() => ({
		conversations, loaded, unavailable, activeId, openConversation, refresh, upsertConversation, applyMessage, markRead, loadDirectory, createDirect, createSpace,
	}), [conversations, loaded, unavailable, activeId, openConversation, refresh, upsertConversation, applyMessage, markRead, loadDirectory, createDirect, createSpace]);

	return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

/** Display name of a conversation: the space name, or the other people in a direct message. */
export function conversationTitle(conversation: ChatConversationDto, currentUserId: string | undefined, fallback: string) {
	if (conversation.type === "space") return conversation.name || fallback;
	const others = conversation.members.filter((member) => member.id !== currentUserId);
	return others.map((member) => member.name).join(", ") || conversation.members[0]?.name || fallback;
}

export function conversationAvatarUser(conversation: ChatConversationDto, currentUserId: string | undefined): ChatUserDto | null {
	if (conversation.type === "space") return null;
	return conversation.members.find((member) => member.id !== currentUserId) ?? conversation.members[0] ?? null;
}
