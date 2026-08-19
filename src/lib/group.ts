import type { Note, NoteStub } from './types';

/**
 * Groups.
 *
 * A note used to be able to hang off another note, which gave every group a
 * head: one thought became the document and the rest read as comments on it,
 * so adding a fourth thought meant deciding what the first one was *about*.
 * The container is the tag now. Every note carrying `#dental` is a peer of
 * every other one, ordered only by when it was written, and there is nothing
 * for a first note to be first of.
 *
 * You still never build a group — a tag becomes a place the second time you
 * reach for it — but naming it once is what buys the flat structure. That name
 * is the whole cost, and it's paid with one tap on a chip that already exists.
 *
 * Everything here is pure so the server load and the client render agree.
 */

/** A note's groups, in a stable order — PostgREST returns joined tag rows in
 *  whatever order the join produced, so "the first tag" has to mean the same
 *  thing on the server as it does after a client-side re-render. */
export function groupsOf(note: Note): string[] {
	return note.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b));
}

/**
 * The group a note is being read inside.
 *
 * A note with three tags belongs to three groups at once, so which one you're
 * looking at is a property of the visit rather than of the note — `preferred`
 * is what the URL asked for, and it only wins if the note actually carries it.
 */
export function primaryGroup(note: Note, preferred?: string | null): string | null {
	const own = groupsOf(note);
	if (preferred && own.includes(preferred)) return preferred;
	return own[0] ?? null;
}

/** A group is read in the order it was written. */
export function oldestFirst(a: Note, b: Note): number {
	return (a.created_at ?? '').localeCompare(b.created_at ?? '');
}

/** A short handle for a note, for the places that have to name one: an aria
 *  label, a card. Never a title anyone had to invent — always the first thing
 *  they actually wrote. */
export function noteLabel(note: Note, max = 60): string {
	const raw = (note.source_title || note.title || note.content_markdown || '')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/[#>*_`~]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!raw) return 'this thought';
	return raw.length > max ? raw.slice(0, max - 1) + '…' : raw;
}

/** The card-sized version of a note. */
export function stubOf(note: Note): NoteStub {
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
		label: noteLabel(note),
		image: note.source_image ?? null,
		source,
		at: note.updated_at || note.created_at
	};
}
