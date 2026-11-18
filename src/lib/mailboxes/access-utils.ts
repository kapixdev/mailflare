import type { AppDatabase } from "@/db";

// Fork: license gating removed — shared mailboxes are always enabled.
export async function isTeamMailboxSharingEnabled(_db: AppDatabase): Promise<boolean> {
	return true;
}
