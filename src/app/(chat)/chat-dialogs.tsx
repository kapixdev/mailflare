"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import toast from "react-hot-toast";
import { Check, Search, UsersRound } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ChatUserDto } from "@/lib/chat/types";
import { useChat } from "./chat-context";

const AVATAR_COLORS = ["bg-blue-600", "bg-emerald-600", "bg-amber-600", "bg-rose-600", "bg-violet-600", "bg-cyan-700", "bg-fuchsia-600", "bg-lime-700"];

function colorFor(id: string) {
	let hash = 0;
	for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
	return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function ChatAvatar({ user, space, size = 36, className }: { user?: Pick<ChatUserDto, "id" | "name" | "avatarUrl"> | null; space?: { id: string; name: string | null }; size?: number; className?: string }) {
	const [failed, setFailed] = useState(false);
	const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
	if (space) {
		return (
			<span style={style} className={clsx("flex shrink-0 items-center justify-center rounded-xl font-semibold text-white", colorFor(space.id), className)} aria-hidden>
				{(space.name || "#").trim().charAt(0).toUpperCase() || <UsersRound size={size * 0.5} />}
			</span>
		);
	}
	if (user?.avatarUrl && !failed) {
		// eslint-disable-next-line @next/next/no-img-element
		return <img src={user.avatarUrl} alt="" style={style} onError={() => setFailed(true)} className={clsx("shrink-0 rounded-full object-cover", className)} />;
	}
	return (
		<span style={style} className={clsx("flex shrink-0 items-center justify-center rounded-full font-semibold text-white", colorFor(user?.id ?? "?"), className)} aria-hidden>
			{(user?.name || "?").trim().charAt(0).toUpperCase()}
		</span>
	);
}

/** Lives inside DialogContent, which unmounts when the dialog closes, so the search starts fresh each time. */
function usePeople(exclude: string[]) {
	const { loadDirectory } = useChat();
	const [people, setPeople] = useState<ChatUserDto[] | null>(null);
	const [query, setQuery] = useState("");
	useEffect(() => {
		let cancelled = false;
		void loadDirectory().then((users) => { if (!cancelled) setPeople(users); });
		return () => { cancelled = true; };
	}, [loadDirectory]);
	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		const excluded = new Set(exclude);
		return (people ?? []).filter((person) => !excluded.has(person.id) && (!needle || person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle)));
	}, [people, query, exclude]);
	return { people, filtered, query, setQuery };
}

function PeopleList({ people, loading, selected, onPick }: { people: ChatUserDto[]; loading: boolean; selected?: Set<string>; onPick: (user: ChatUserDto) => void }) {
	const { t } = useLanguage();
	if (loading) return <p className="px-3 py-6 text-center text-sm text-neutral-500">{t("common.loading")}</p>;
	if (people.length === 0) return <p className="px-3 py-6 text-center text-sm text-neutral-500">{t("chat.noPeople")}</p>;
	return (
		<ul className="max-h-72 space-y-0.5 overflow-y-auto">
			{people.map((person) => {
				const isSelected = selected?.has(person.id);
				return (
					<li key={person.id}>
						<button type="button" onClick={() => onPick(person)} aria-pressed={selected ? isSelected : undefined} className={clsx("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-neutral-100", isSelected && "bg-blue-50")}>
							<ChatAvatar user={person} size={32} />
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium text-neutral-900">{person.name}</span>
								<span className="block truncate text-xs text-neutral-500">{person.email}</span>
							</span>
							{isSelected && <Check size={16} className="text-blue-600" />}
						</button>
					</li>
				);
			})}
		</ul>
	);
}

function SearchField({ value, onChange, autoFocus = true }: { value: string; onChange: (value: string) => void; autoFocus?: boolean }) {
	const { t } = useLanguage();
	return (
		<div className="relative mb-3">
			<Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
			<Input autoFocus={autoFocus} value={value} onChange={(event) => onChange(event.target.value)} placeholder={t("chat.searchPeople")} aria-label={t("chat.searchPeople")} className="pl-9" />
		</div>
	);
}

/** Starts (or reopens) a one-to-one conversation. */
export function NewDirectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const { t } = useLanguage();
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader><DialogTitle>{t("chat.newDirect")}</DialogTitle></DialogHeader>
				<DirectPicker onDone={() => onOpenChange(false)} />
			</DialogContent>
		</Dialog>
	);
}

function DirectPicker({ onDone }: { onDone: () => void }) {
	const { t } = useLanguage();
	const { createDirect, openConversation } = useChat();
	const { people, filtered, query, setQuery } = usePeople(NO_IDS);
	const [busy, setBusy] = useState(false);
	const pick = async (user: ChatUserDto) => {
		if (busy) return;
		setBusy(true);
		try {
			const conversation = await createDirect(user.id);
			onDone();
			openConversation(conversation.id);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("chat.loadFailed"));
			setBusy(false);
		}
	};
	return (
		<>
			<SearchField value={query} onChange={setQuery} />
			<PeopleList people={filtered} loading={people === null} onPick={(user) => void pick(user)} />
		</>
	);
}

const NO_IDS: string[] = [];

type SpaceDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	addTo?: { id: string; memberIds: string[] };
	onAdd?: (userIds: string[]) => Promise<void>;
};

/** Creates a space, or adds people to an existing one when `addTo` is set. */
export function SpaceDialog(props: SpaceDialogProps) {
	const [busy, setBusy] = useState(false);
	return (
		<Dialog open={props.open} onOpenChange={(value) => { if (!busy) props.onOpenChange(value); }}>
			<DialogContent>
				<SpaceForm {...props} busy={busy} setBusy={setBusy} />
			</DialogContent>
		</Dialog>
	);
}

function SpaceForm({ onOpenChange, addTo, onAdd, busy, setBusy }: SpaceDialogProps & { busy: boolean; setBusy: (busy: boolean) => void }) {
	const { t } = useLanguage();
	const { createSpace, openConversation } = useChat();
	const exclude = addTo?.memberIds ?? NO_IDS;
	const { people, filtered, query, setQuery } = usePeople(exclude);
	const [name, setName] = useState("");
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const toggle = (user: ChatUserDto) => setSelected((current) => {
		const next = new Set(current);
		if (next.has(user.id)) next.delete(user.id); else next.add(user.id);
		return next;
	});
	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		try {
			if (addTo) {
				await onAdd?.([...selected]);
				setBusy(false);
				onOpenChange(false);
			} else {
				const conversation = await createSpace(name, [...selected]);
				setBusy(false);
				onOpenChange(false);
				openConversation(conversation.id);
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("chat.loadFailed"));
			setBusy(false);
		}
	};
	return (
		<form onSubmit={(event) => void submit(event)}>
			<DialogHeader>
				<DialogTitle>{addTo ? t("chat.addPeople") : t("chat.newSpace")}</DialogTitle>
				{!addTo && <DialogDescription>{t("chat.newSpaceHint")}</DialogDescription>}
			</DialogHeader>
			{!addTo && (
				<div className="mb-4">
					<label htmlFor="chat-space-name" className="mb-1.5 block text-sm font-medium text-neutral-700">{t("chat.spaceName")}</label>
					<Input id="chat-space-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("chat.spaceNamePlaceholder")} maxLength={80} autoFocus />
				</div>
			)}
			<SearchField value={query} onChange={setQuery} autoFocus={!!addTo} />
			<PeopleList people={filtered} loading={people === null} selected={selected} onPick={toggle} />
			<div className="mt-5 flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
				<Button type="submit" disabled={busy || (addTo ? selected.size === 0 : !name.trim())}>{addTo ? t("chat.add") : t("chat.create")}</Button>
			</div>
		</form>
	);
}

type RenameProps = { open: boolean; onOpenChange: (open: boolean) => void; initialName: string; onSave: (name: string) => Promise<void> };

export function RenameSpaceDialog(props: RenameProps) {
	const [busy, setBusy] = useState(false);
	return (
		<Dialog open={props.open} onOpenChange={(value) => { if (!busy) props.onOpenChange(value); }}>
			<DialogContent>
				<RenameForm {...props} busy={busy} setBusy={setBusy} />
			</DialogContent>
		</Dialog>
	);
}

function RenameForm({ onOpenChange, initialName, onSave, busy, setBusy }: RenameProps & { busy: boolean; setBusy: (busy: boolean) => void }) {
	const { t } = useLanguage();
	const [name, setName] = useState(initialName);
	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (busy || !name.trim()) return;
		setBusy(true);
		try {
			await onSave(name);
			setBusy(false);
			onOpenChange(false);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("chat.loadFailed"));
			setBusy(false);
		}
	};
	return (
		<form onSubmit={(event) => void submit(event)}>
			<DialogHeader><DialogTitle>{t("chat.rename")}</DialogTitle></DialogHeader>
			<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus aria-label={t("chat.spaceName")} />
			<div className="mt-5 flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
				<Button type="submit" disabled={busy || !name.trim()}>{t("common.save")}</Button>
			</div>
		</form>
	);
}
