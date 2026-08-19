import type { Note, ThreadStub } from './types';

/**
 * Threads.
 *
 * A thread is not a container you create — it's what a note becomes the
 * moment you add a second thought to it. So there's no thread table and no
 * thread id: a continuation is an ordinary note carrying `parent_id`, and a
 * thread is assembled here, at read time, out of the flat list the stream
 * already loads.
 *
 * Everything below is pure so the server load and the client's optimistic
 * merge can build the same shape from the same rules.
 */

function oldestFirst(a: Note, b: Note): number {
	return (a.created_at ?? '').localeCompare(b.created_at ?? '');
}

/**
 * Fold continuations into the notes they continue.
 *
 * Roots keep the order they came in — the caller has already decided what
 * "recent" means — and each carries its own thoughts oldest-first, because a
 * thread is read as it was written.
 *
 * A continuation whose parent isn't in this window (it scrolled past the
 * limit, or a filter dropped it) is promoted to a root rather than dropped.
 * A thought that exists must always be on screen somewhere.
 */
export function attachChildren(notes: Note[]): Note[] {
	const present = new Set(notes.map((n) => n.id));
	const kids = new Map<string, Note[]>();

	for (const note of notes) {
		if (!note.parent_id || !present.has(note.parent_id)) continue;
		const list = kids.get(note.parent_id);
		if (list) list.push(note);
		else kids.set(note.parent_id, [note]);
	}

	const roots: Note[] = [];
	for (const note of notes) {
		if (note.parent_id && present.has(note.parent_id)) continue;
		const own = kids.get(note.id);
		roots.push(own ? { ...note, children: [...own].sort(oldestFirst) } : note);
	}
	return roots;
}

/** How many thoughts have been added since the first one. */
export function threadCount(note: Note): number {
	return note.children?.length ?? 0;
}

/** The whole thread as one list — the head, then its thoughts in order. */
export function threadNotes(note: Note): Note[] {
	return note.children?.length ? [note, ...note.children] : [note];
}

/** When the thread was last touched, for the "last 2h ago" line. */
export function lastActivity(note: Note): string {
	const kids = note.children;
	if (!kids || kids.length === 0) return note.updated_at || note.created_at;
	return kids[kids.length - 1].created_at || note.updated_at;
}

/** A short handle for a thread, used wherever we have to name one: the
 *  continuing chip, the recent strip, an aria label. Never a title the user
 *  had to invent — always the first thing they actually wrote. */
export function threadLabel(note: Note, max = 42): string {
	const raw = (note.source_title || note.title || note.content_markdown || '')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/[#>*_`~]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!raw) return 'this thought';
	return raw.length > max ? raw.slice(0, max - 1) + '…' : raw;
}

/** The card-sized version of a note: what the composer and the recent strip
 *  need in order to offer it as somewhere to write. */
export function stubOf(note: Note): ThreadStub {
	let source: string | null = null;
	if (note.source_url) {
		try {
			source = new URL(note.source_url).hostname.replace(/^www\./, '');
		} catch {
			source = null;
		}
	}

	return {
		id: note.id,
		label: threadLabel(note, 60),
		image: note.source_image ?? null,
		source,
		count: threadCount(note),
		at: lastActivity(note)
	};
}
