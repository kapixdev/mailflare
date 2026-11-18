"use client";

import { useState } from "react";
import clsx from "clsx";
import toast from "react-hot-toast";
import { X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { authFetch } from "@/lib/auth/client";
import { CHAT_POST_POLICIES, isChatAdmin } from "@/lib/chat/permissions";
import type { ChatConversationDto, ChatMemberDto, ChatPostPolicy } from "@/lib/chat/types";
import { chatPostJson, useChat } from "../chat-context";
import { ChatAvatar } from "../chat-dialogs";

const POLICY_LABELS = {
	everyone: { title: "chat.policyEveryone", hint: "chat.policyEveryoneHint" },
	admins: { title: "chat.policyAdmins", hint: "chat.policyAdminsHint" },
	admins_threads: { title: "chat.policyAdminsThreads", hint: "chat.policyAdminsThreadsHint" },
} as const satisfies Record<ChatPostPolicy, { title: string; hint: string }>;

function conversationUrl(id: string) {
	return `/api/chat/conversations/${encodeURIComponent(id)}`;
}

type SettingsProps = { open: boolean; onOpenChange: (open: boolean) => void; conversation: ChatConversationDto };

/** Name and posting permissions of a space (owner and admins). */
export function SpaceSettingsDialog(props: SettingsProps) {
	const [busy, setBusy] = useState(false);
	return (
		<Dialog open={props.open} onOpenChange={(value) => { if (!busy) props.onOpenChange(value); }}>
			<DialogContent>
				<SettingsForm {...props} busy={busy} setBusy={setBusy} />
			</DialogContent>
		</Dialog>
	);
}

function SettingsForm({ onOpenChange, conversation, busy, setBusy }: SettingsProps & { busy: boolean; setBusy: (busy: boolean) => void }) {
	const { t } = useLanguage();
	const { upsertConversation } = useChat();
	const [name, setName] = useState(conversation.name ?? "");
	const [policy, setPolicy] = useState<ChatPostPolicy>(conversation.postPolicy);
	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (busy || !name.trim()) return;
		setBusy(true);
		try {
			const { conversation: updated } = await chatPostJson<{ conversation: ChatConversationDto }>(conversationUrl(conversation.id), { name, postPolicy: policy }, "PATCH");
			upsertConversation(updated);
			setBusy(false);
			onOpenChange(false);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("chat.loadFailed"));
			setBusy(false);
		}
	};
	return (
		<form onSubmit={(event) => void submit(event)}>
			<DialogHeader>
				<DialogTitle>{t("chat.spaceSettings")}</DialogTitle>
			</DialogHeader>
			<div className="mb-5">
				<label htmlFor="chat-space-settings-name" className="mb-1.5 block text-sm font-medium text-neutral-700">{t("chat.spaceName")}</label>
				<Input id="chat-space-settings-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus />
			</div>
			<fieldset>
				<legend className="mb-1 text-sm font-medium text-neutral-700">{t("chat.whoCanPost")}</legend>
				<div className="space-y-1.5">
					{CHAT_POST_POLICIES.map((value) => (
						<label key={value} className={clsx("flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5", policy === value ? "border-blue-400 bg-blue-50/60" : "border-neutral-200 hover:bg-neutral-50")}>
							<input type="radio" name="chat-post-policy" value={value} checked={policy === value} onChange={() => setPolicy(value)} className="mt-1" />
							<span>
								<span className="block text-sm font-medium text-neutral-900">{t(POLICY_LABELS[value].title)}</span>
								<span className="block text-xs text-neutral-500">{t(POLICY_LABELS[value].hint)}</span>
							</span>
						</label>
					))}
				</div>
			</fieldset>
			<div className="mt-5 flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
				<Button type="submit" disabled={busy || !name.trim()}>{t("common.save")}</Button>
			</div>
		</form>
	);
}

type MembersProps = { open: boolean; onOpenChange: (open: boolean) => void; conversation: ChatConversationDto; currentUserId?: string };

/** Member list; owner and admins can promote, demote and remove people. */
export function MembersDialog({ open, onOpenChange, conversation, currentUserId }: MembersProps) {
	const { t } = useLanguage();
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("chat.members")}</DialogTitle>
					{conversation.postPolicy !== "everyone" && <DialogDescription>{t(POLICY_LABELS[conversation.postPolicy].hint)}</DialogDescription>}
				</DialogHeader>
				<MemberList conversation={conversation} currentUserId={currentUserId} />
			</DialogContent>
		</Dialog>
	);
}

function MemberList({ conversation, currentUserId }: { conversation: ChatConversationDto; currentUserId?: string }) {
	const { t } = useLanguage();
	const { refresh, upsertConversation } = useChat();
	const [busy, setBusy] = useState<string | null>(null);
	const manage = conversation.type === "space" && isChatAdmin(conversation.role);
	const base = conversationUrl(conversation.id);

	const run = async (member: ChatMemberDto, action: () => Promise<void>) => {
		setBusy(member.id);
		try {
			await action();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("chat.loadFailed"));
		} finally {
			setBusy(null);
		}
	};

	const changeRole = (member: ChatMemberDto, role: "admin" | "member") => run(member, async () => {
		const { conversation: updated } = await chatPostJson<{ conversation: ChatConversationDto }>(`${base}/members`, { userId: member.id, role }, "PATCH");
		upsertConversation(updated);
	});

	const remove = (member: ChatMemberDto) => run(member, async () => {
		const ok = await confirmDestructive({ title: t("chat.removeMember"), message: t("chat.removeMemberConfirm", { name: member.name }), confirmLabel: t("chat.remove") });
		if (!ok) return;
		const response = await authFetch(`${base}/members?userId=${encodeURIComponent(member.id)}`, { method: "DELETE" });
		if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || t("chat.loadFailed"));
		await refresh();
	});

	return (
		<ul className="max-h-96 space-y-0.5 overflow-y-auto">
			{conversation.members.map((member) => {
				const editable = manage && member.id !== currentUserId && member.role !== "owner";
				return (
					<li key={member.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
						<ChatAvatar user={member} size={32} />
						<span className="min-w-0 flex-1">
							<span className="block truncate text-sm font-medium text-neutral-900">
								{member.name}
								{member.id === currentUserId && <span className="font-normal text-neutral-500"> ({t("chat.you")})</span>}
							</span>
							<span className="block truncate text-xs text-neutral-500">{member.email}</span>
						</span>
						{editable ? (
							<>
								<select
									value={member.role}
									disabled={busy === member.id}
									onChange={(event) => void changeRole(member, event.target.value === "admin" ? "admin" : "member")}
									aria-label={t("chat.roleFor", { name: member.name })}
									className="h-8 rounded-lg border border-neutral-200 bg-white px-2 text-xs text-neutral-700"
								>
									<option value="member">{t("chat.roleMember")}</option>
									<option value="admin">{t("chat.roleAdmin")}</option>
								</select>
								<Button type="button" variant="ghost" size="icon" aria-label={t("chat.removeMemberNamed", { name: member.name })} title={t("chat.remove")} disabled={busy === member.id} onClick={() => void remove(member)}>
									<X size={16} />
								</Button>
							</>
						) : member.role !== "member" && conversation.type === "space" ? (
							<span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", member.role === "owner" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800")}>
								{member.role === "owner" ? t("chat.roleOwner") : t("chat.roleAdmin")}
							</span>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}
