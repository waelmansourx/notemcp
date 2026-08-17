// Local-first capture: writing to localStorage is synchronous, so "Saved" can
// show instantly instead of waiting on the network. The actual POST goes out
// with keepalive so it survives us closing the tab right after; if it never
// makes it out at all (fully offline), the entry stays queued here and is
// retried the next time the app opens.

const KEY = 'notemcp:outbox';

export interface OutboxEntry {
	client_id: string;
	title: string;
	content_markdown: string;
	source_url: string | null;
	source_type: string | null;
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
	localStorage.setItem(KEY, JSON.stringify(entries));
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
	try {
		const res = await fetch('/api/notes', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			keepalive: true,
			body: JSON.stringify({
				title: entry.title,
				content_markdown: entry.content_markdown,
				source_url: entry.source_url,
				source_type: entry.source_type,
				tagNames: entry.tagNames
			})
		});
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
}

/** Fire the sync in the background; caller doesn't need to await this. */
export function syncEntry(entry: OutboxEntry, onSynced?: (id: string) => void) {
	send(entry).then((note) => {
		if (note) {
			removeFromOutbox(entry.client_id);
			onSynced?.(note.id);
		}
		// else: leave it queued, flushOutbox() will retry next app open.
	});
}

/** Retry anything left over from a previous session (e.g. was offline). */
export async function flushOutbox(): Promise<void> {
	for (const entry of readOutbox()) {
		const note = await send(entry);
		if (note) removeFromOutbox(entry.client_id);
	}
}
