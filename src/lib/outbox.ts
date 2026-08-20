// Local-first capture: writing to localStorage is synchronous, so "Saved" can
// show instantly instead of waiting on the network. The actual POST goes out
// with keepalive so it survives us closing the tab right after; if it never
// makes it out at all (fully offline), the entry stays queued here and is
// retried the next time the app opens.

import { clearDraft } from './draft.svelte';

const KEY = 'notemcp:outbox';

// Chrome caps in-flight keepalive request bodies around 64KB combined. A
// captured screenshot embedded as base64 can blow past that, so anything
// large falls back to a normal (non-keepalive) request instead.
const KEEPALIVE_SAFE_BYTES = 60_000;

export interface OutboxEntry {
	client_id: string;
	title: string;
	content_markdown: string;
	source_url: string | null;
	source_type: string | null;
	source_title: string | null;
	source_description: string | null;
	source_image: string | null;
	/** Set when this thought was written into an existing thread. */
	parent_id: string | null;
	tagNames: string[];
	queued_at: string;
}

function readOutbox(): OutboxEntry[] {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '[]');
	} catch {
		return [];
	}
}

function writeOutbox(entries: OutboxEntry[]) {
	try {
		localStorage.setItem(KEY, JSON.stringify(entries));
	} catch {
		// localStorage full (e.g. a large embedded image) — nothing more we
		// can do locally; the caller's fetch is still the source of truth.
	}
}

export function queueNote(
	entry: Omit<OutboxEntry, 'client_id' | 'queued_at'> & { client_id?: string }
): OutboxEntry {
	const full: OutboxEntry = {
		...entry,
		// The caller passes its own id when it has already POSTed under one —
		// re-queueing a failed create has to resolve to the same row the first
		// attempt might have written, not a second copy of the note.
		client_id: entry.client_id ?? crypto.randomUUID(),
		queued_at: new Date().toISOString()
	};
	// Replace rather than append: a create that keeps failing while you keep
	// typing would otherwise leave one entry per attempt.
	writeOutbox([...readOutbox().filter((e) => e.client_id !== full.client_id), full]);
	return full;
}

export function removeFromOutbox(clientId: string) {
	writeOutbox(readOutbox().filter((e) => e.client_id !== clientId));
}

async function send(entry: OutboxEntry): Promise<{ id: string } | null> {
	const payload = JSON.stringify({
		// The server keys on this to make a retry resolve to the row the first
		// attempt already wrote, rather than creating a second copy.
		client_id: entry.client_id,
		title: entry.title,
		content_markdown: entry.content_markdown,
		source_url: entry.source_url,
		source_type: entry.source_type,
		source_title: entry.source_title,
		source_description: entry.source_description,
		source_image: entry.source_image,
		parent_id: entry.parent_id,
		tagNames: entry.tagNames
	});

	try {
		const res = await fetch('/api/notes', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			keepalive: payload.length < KEEPALIVE_SAFE_BYTES,
			body: payload
		});
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
}

/** Fire the sync in the background; caller doesn't need to await this. */
export function syncEntry(
	entry: OutboxEntry,
	onSynced?: (id: string) => void,
	onQueued?: () => void
) {
	send(entry).then((note) => {
		if (note) {
			removeFromOutbox(entry.client_id);
			onSynced?.(note.id);
		} else {
			// Left queued; flushOutbox() retries on the next app open. Worth
			// saying out loud, because the note is on screen either way and
			// silence would read as "synced".
			onQueued?.();
		}
	});
}

/** Await the sync directly — used when the payload is too large to trust to keepalive. */
export async function syncEntryNow(entry: OutboxEntry): Promise<string | null> {
	const note = await send(entry);
	if (note) removeFromOutbox(entry.client_id);
	return note?.id ?? null;
}

/* ---------------- edits ----------------

   Everything above covers writing a thought. Changing one had none of it:
   the editor PATCHed directly, and a request that died left the words in a
   draft that nothing would ever send — so an edit made on a bad connection
   was only ever as durable as that one localStorage key, and a note edited
   offline silently stayed as the server had it. "Saved on this device and
   synced later" has to mean the same thing for changing a thought as it
   does for writing one, so a failed PATCH is queued here and retried on the
   next app open, exactly like a failed POST.

   Keyed by note id and merged field-by-field: several failed saves of the
   same note collapse into one pending patch holding the newest value of
   each field, which is also the smallest write that gets the server there. */

const EDIT_KEY = 'notemcp:edits';

export interface EditEntry {
	note_id: string;
	/** Only the fields that actually changed, newest value of each. */
	patch: Record<string, unknown>;
	queued_at: string;
}

function readEdits(): EditEntry[] {
	try {
		return JSON.parse(localStorage.getItem(EDIT_KEY) ?? '[]');
	} catch {
		return [];
	}
}

function writeEdits(entries: EditEntry[]) {
	try {
		localStorage.setItem(EDIT_KEY, JSON.stringify(entries));
	} catch {
		// Out of room. The draft is still holding the text either way.
	}
}

export function queueEdit(noteId: string, patch: Record<string, unknown>) {
	const entries = readEdits();
	const existing = entries.find((e) => e.note_id === noteId);
	writeEdits([
		...entries.filter((e) => e.note_id !== noteId),
		{
			note_id: noteId,
			patch: { ...(existing?.patch ?? {}), ...patch },
			queued_at: new Date().toISOString()
		}
	]);
}

export function removeEdit(noteId: string) {
	writeEdits(readEdits().filter((e) => e.note_id !== noteId));
}

/** True when this device is still holding an unsent change to this note. */
export function hasQueuedEdit(noteId: string): boolean {
	return readEdits().some((e) => e.note_id === noteId);
}

// An entry that has failed to send for this long is never going to. Without a
// ceiling it would be retried on every app open forever, and sit in
// localStorage taking up room a real capture might need.
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** Retry anything left over from a previous session (e.g. was offline). */
export async function flushOutbox(): Promise<void> {
	const cutoff = Date.now() - STALE_AFTER_MS;

	for (const entry of readOutbox()) {
		if (new Date(entry.queued_at).getTime() < cutoff) {
			removeFromOutbox(entry.client_id);
			continue;
		}
		// Safe to re-send: the server keys on client_id, so a note that
		// actually made it out the first time resolves to its existing row
		// rather than being duplicated.
		const note = await send(entry);
		if (note) removeFromOutbox(entry.client_id);
	}
}

/**
 * Retry edits the same way. Runs after flushOutbox so that a thought which
 * was still queued as a create is a real note by the time anything tries to
 * patch it.
 *
 * The draft is cleared only once the server has actually taken the change —
 * until then it stays put, because it's the copy the editor reads back.
 */
export async function flushEdits(): Promise<void> {
	const cutoff = Date.now() - STALE_AFTER_MS;

	for (const entry of readEdits()) {
		if (new Date(entry.queued_at).getTime() < cutoff) {
			removeEdit(entry.note_id);
			continue;
		}
		try {
			const res = await fetch(`/api/notes/${entry.note_id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(entry.patch)
			});
			// A note deleted on another device can never accept this patch;
			// keeping it would mean retrying forever.
			if (res.ok || res.status === 404) {
				removeEdit(entry.note_id);
				clearDraft(entry.note_id);
			}
		} catch {
			// Still offline. Leave it queued for the next open.
		}
	}
}
