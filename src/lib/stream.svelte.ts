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
		parent_id: entry.parent_id,
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

/**
 * The server has this one now.
 *
 * Swapping in the real id is what takes the note out of its "still syncing"
 * look — full opacity, openable — the moment the POST comes back, instead of
 * at the end of the stream refetch that follows it. The local copy stays in
 * the list until that refetch lands, so nothing blinks; `withPending` drops it
 * by `client_id` once the server's version is in the loaded data.
 */
export function settlePending(clientId: string, id: string) {
	pending.items = pending.items.map((n) => (n.client_id === clientId ? { ...n, id } : n));
}

export function removePending(clientId: string) {
	pending.items = pending.items.filter((n) => n.client_id !== clientId);
}

/**
 * Merge queued notes into a loaded stream of threads.
 *
 * A note that has already come back from the server is dropped from the
 * pending side by `client_id`, so the hand-off between the two is invisible
 * rather than a flicker of duplicates.
 *
 * A queued *continuation* is folded into the thread it belongs to and that
 * thread moves to the top — the same thing the server's trigger will do a
 * moment later. Appending has to look like appending straight away, or the
 * gesture reads as having gone nowhere.
 */
export function withPending(roots: Note[]): Note[] {
	if (pending.items.length === 0) return roots;

	const known = new Set<string>();
	for (const root of roots) {
		if (root.client_id) known.add(root.client_id);
		for (const child of root.children ?? []) if (child.client_id) known.add(child.client_id);
	}

	const queued = pending.items.filter((n) => !(n.client_id && known.has(n.client_id)));
	if (queued.length === 0) return roots;

	const appended = new Map<string, Note[]>();
	const fresh: Note[] = [];
	for (const note of queued) {
		if (!note.parent_id) {
			fresh.push(note);
			continue;
		}
		const list = appended.get(note.parent_id);
		if (list) list.push(note);
		else appended.set(note.parent_id, [note]);
	}

	if (appended.size === 0) return [...fresh, ...roots];

	// Threads that just gained a thought come first, in the order they were
	// touched, then everything else as it was.
	const touched: Note[] = [];
	const rest: Note[] = [];
	for (const root of roots) {
		const added = appended.get(root.id);
		if (!added) {
			rest.push(root);
			continue;
		}
		appended.delete(root.id);
		touched.push({ ...root, children: [...(root.children ?? []), ...added] });
	}

	// A continuation whose thread isn't in this window still has to be
	// visible, so it stands on its own rather than disappearing.
	const orphans = [...appended.values()].flat();

	return [...fresh, ...orphans, ...touched, ...rest];
}
