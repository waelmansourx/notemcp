import type { Note } from './types';
import type { OutboxEntry } from './outbox';

/**
 * Notes that exist locally but not yet on the server.
 *
 * A capture is written to localStorage and POSTed in the background, so it is
 * real the instant you tap Keep — the only thing missing is a round trip. The
 * stream reads from here as well as from the loaded data, so a new thought
 * lands in the list immediately instead of after a POST plus a full page
 * invalidation, which is what made saving feel like it hung on "Saved".
 */
export const pending = $state<{ items: Note[] }>({ items: [] });

/** Shape a queued outbox entry like a Note so the stream can render it. */
export function asNote(entry: OutboxEntry): Note {
	return {
		id: `pending:${entry.client_id}`,
		client_id: entry.client_id,
		user_id: '',
		title: entry.title,
		content_markdown: entry.content_markdown,
		source_url: entry.source_url,
		source_type: entry.source_type,
		source_title: entry.source_title,
		source_description: entry.source_description,
		source_image: entry.source_image,
		folder_id: null,
		pinned: false,
		archived: false,
		created_at: entry.queued_at,
		updated_at: entry.queued_at,
		deleted_at: null,
		tags: entry.tagNames.map((name) => ({ id: `pending:${name}`, name }))
	};
}

/** True for a note that is still only local — it has no server id to open. */
export function isPending(note: Note): boolean {
	return note.id.startsWith('pending:');
}

export function addPending(entry: OutboxEntry) {
	pending.items = [asNote(entry), ...pending.items];
}

export function removePending(clientId: string) {
	pending.items = pending.items.filter((n) => n.client_id !== clientId);
}

/**
 * Merge queued notes into a loaded list. A note that has already come back
 * from the server is dropped from the pending side by `client_id`, so the
 * hand-off between the two is invisible rather than a flicker of duplicates.
 */
export function withPending(notes: Note[]): Note[] {
	if (pending.items.length === 0) return notes;
	const known = new Set(notes.map((n) => n.client_id).filter(Boolean));
	const queued = pending.items.filter((n) => !known.has(n.client_id));
	return queued.length > 0 ? [...queued, ...notes] : notes;
}
