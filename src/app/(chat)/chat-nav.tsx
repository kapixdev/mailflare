"use client";

import { useState } from "react";
import clsx from "clsx";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MessageCirclePlus, UserRound, UsersRound } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { PoweredBy } from "@/components/sidebar-footer";
import { useSidebar } from "@/components/sidebar-state";
import { useCurrentUser } from "@/hooks/use-current-user";
import type { ChatConversationDto } from "@/lib/chat/types";
import { conversationAvatarUser, conversationTitle, useChat } from "./chat-context";
import { ChatAvatar, NewDirectDialog, SpaceDialog } from "./chat-dialogs";

const itemClass = "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-700 outline-none data-[highlighted]:bg-neutral-100";

function ConversationRow({ conversation, active, compact, currentUserId, onSelect }: { conversation: ChatConversationDto; active: boolean; compact: boolean; currentUserId?: string; onSelect: () => void }) {
	const { t } = useLanguage();
	const title = conversationTitle(conversation, currentUserId, t("chat.untitled"));
	const unread = conversation.unreadCount > 0;
	const avatar = conversation.type === "space"
		? <ChatAvatar space={{ id: conversation.id, name: conversation.name }} size={compact ? 32 : 28} />
		: <ChatAvatar user={conversationAvatarUser(conversation, currentUserId)} size={compact ? 32 : 28} />;
	return (
		<button
			type="button"
			onClick={onSelect}
			aria-current={active ? "page" : undefined}
			title={compact ? title : undefined}
			className={clsx(
				"relative flex w-full items-center gap-3 rounded-full text-left text-sm",
				compact ? "h-11 w-11 justify-center" : "h-10 px-3",
				active ? "bg-blue-100 text-blue-900" : "text-neutral-700 hover:bg-neutral-200/60",
			)}
		>
			{avatar}
			{!compact && <span className={clsx("min-w-0 flex-1 truncate", (active || unread) && "font-semibold")}>{title}</span>}
			{unread && (compact
				? <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-blue-600" aria-label={t("chat.unread", { count: conversation.unreadCount })} />
				: <span className="rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold leading-5 text-white" aria-label={t("chat.unread", { count: conversation.unreadCount })}>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</span>)}
		</button>
	);
}

export function ChatNav({ onNavigate }: { onNavigate?: () => void }) {
	const { t } = useLanguage();
	const user = useCurrentUser();
	const { minimal, mobile } = useSidebar();
	const compact = minimal && !mobile;
	const { conversations, activeId, openConversation, loaded } = useChat();
	const [directOpen, setDirectOpen] = useState(false);
	const [spaceOpen, setSpaceOpen] = useState(false);
	const directs = conversations.filter((item) => item.type === "direct");
	const spaces = conversations.filter((item) => item.type === "space");

	const select = (id: string) => {
		openConversation(id);
		onNavigate?.();
	};

	const section = (label: string, list: ChatConversationDto[]) => list.length > 0 && (
		<div className="mt-3">
			{!compact && <p className="px-4 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</p>}
			<ul className="space-y-0.5">
				{list.map((conversation) => (
					<li key={conversation.id}>
						<ConversationRow conversation={conversation} active={conversation.id === activeId} compact={compact} currentUserId={user?.id} onSelect={() => select(conversation.id)} />
					</li>
				))}
			</ul>
		</div>
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1">
				<DropdownMenu.Root modal={false}>
					<DropdownMenu.Trigger asChild>
						<button type="button" aria-label={t("chat.new")} className={clsx("mb-2 flex h-14 items-center gap-3 rounded-2xl bg-white text-sm font-medium text-neutral-800 shadow-md transition-shadow hover:shadow-lg", compact ? "w-14 justify-center" : "w-fit px-5")}>
							<MessageCirclePlus size={22} />
							{!compact && t("chat.new")}
						</button>
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content align="start" sideOffset={6} className="z-[200] min-w-52 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl">
							<DropdownMenu.Item className={itemClass} onSelect={() => setDirectOpen(true)}><UserRound size={18} />{t("chat.newDirect")}</DropdownMenu.Item>
							<DropdownMenu.Item className={itemClass} onSelect={() => setSpaceOpen(true)}><UsersRound size={18} />{t("chat.newSpace")}</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
				<nav aria-label={t("chat.conversations")}>
					{section(t("chat.directMessages"), directs)}
					{section(t("chat.spaces"), spaces)}
					{loaded && conversations.length === 0 && !compact && <p className="px-4 pt-4 text-sm text-neutral-500">{t("chat.empty")}</p>}
				</nav>
			</div>
			{!compact && (
				<div className="shrink-0 px-6 py-3">
					<PoweredBy className="" />
				</div>
			)}
			<NewDirectDialog open={directOpen} onOpenChange={setDirectOpen} />
			<SpaceDialog open={spaceOpen} onOpenChange={setSpaceOpen} />
		</div>
	);
}
