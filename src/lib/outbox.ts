// Local-first capture: writing to localStorage is synchronous, so "Saved" can
// show instantly instead of waiting on the network. The actual POST goes out
// with keepalive so it survives us closing the tab right after; if it never
// makes it out at all (fully offline), the entry stays queued here and is
// retried the next time the app opens.

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
	/** Where it goes: the tags it was filed under, if any. */
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

export function queueNote(entry: Omit<OutboxEntry, 'client_id' | 'queued_at'>): OutboxEntry {
	const full: OutboxEntry = {
		...entry,
		client_id: crypto.randomUUID(),
		queued_at: new Date().toISOString()
	};
	writeOutbox([...readOutbox(), full]);
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
