/**
 * A note's text, on this device, right now.
 *
 * Autosave used to fire 600ms after you stopped typing, because the server
 * was the only place the text existed — every pause was a race against
 * closing the tab. Writing to localStorage first inverts that: the note is
 * safe synchronously, so the network write can wait for a real gap in the
 * typing instead of chasing every one.
 *
 * A draft is a crash mat, not a second source of truth. It's written on every
 * change, restored only when it's genuinely newer than what the server
 * returned, and deleted the moment the server has caught up.
 */
const PREFIX = 'notemcp:draft:';

export interface Draft {
	title: string;
	content: string;
	tags: string[];
	at: string;
}

function key(id: string) {
	return PREFIX + id;
}

export function saveDraft(id: string, draft: Omit<Draft, 'at'>) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key(id), JSON.stringify({ ...draft, at: new Date().toISOString() }));
	} catch {
		// Out of room — the server write is still coming, so this is survivable.
	}
}

export function readDraft(id: string): Draft | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(key(id));
		if (!raw) return null;
		const draft = JSON.parse(raw) as Draft;
		return typeof draft?.content === 'string' && typeof draft?.at === 'string' ? draft : null;
	} catch {
		return null;
	}
}

export function clearDraft(id: string) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(key(id));
	} catch {
		/* nothing to do */
	}
}

// A note abandoned before it was ever created is filed under a one-off client
// id nothing will ever look up again. Without a sweep those accumulate in
// localStorage for good, quietly eating the room a queued capture needs.
const KEEP_DRAFTS_MS = 7 * 24 * 60 * 60 * 1000;

export function pruneDrafts() {
	if (typeof localStorage === 'undefined') return;
	const cutoff = Date.now() - KEEP_DRAFTS_MS;

	try {
		const stale: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (!k?.startsWith(PREFIX)) continue;
			try {
				const draft = JSON.parse(localStorage.getItem(k) ?? '') as Draft;
				if (new Date(draft.at).getTime() < cutoff) stale.push(k);
			} catch {
				stale.push(k);
			}
		}
		for (const k of stale) localStorage.removeItem(k);
	} catch {
		/* nothing worth failing a render over */
	}
}

/** Only worth restoring if it's both different from and newer than the
 *  server's copy — otherwise it's just the same words with an older date on
 *  them, and offering to "recover" those is noise. */
export function isNewerThan(draft: Draft, serverUpdatedAt: string | null | undefined): boolean {
	if (!serverUpdatedAt) return true;
	return new Date(draft.at).getTime() > new Date(serverUpdatedAt).getTime();
}
