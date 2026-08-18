import type { Note } from './types';

/**
 * A local copy of the last stream that loaded.
 *
 * The page is still server-rendered, so this isn't what you normally see —
 * it's what you see when the server couldn't answer. A flaky connection, a
 * Supabase hiccup or a cold function used to leave the stream empty, which
 * reads as "your notes are gone" rather than "the network is having a
 * moment". Reading from here instead means the app always has something to
 * show, and the notes you already had are never further away than the disk.
 */
const KEY = 'notemcp:stream';

// Enough to fill several screens of scrolling. Past that we'd be spending
// the localStorage budget a queued capture might need.
const MAX_NOTES = 120;

// A note carrying an embedded photo is a base64 data URL running to
// megabytes. One of those would blow the whole quota, so oversized bodies are
// stored trimmed — the cached stream only ever renders an excerpt anyway, and
// the note's own page always loads the real thing from the server.
const MAX_BODY = 4_000;

interface Snapshot {
	at: string;
	notes: Note[];
}

export function saveStream(notes: Note[]) {
	if (typeof localStorage === 'undefined') return;

	const snapshot: Snapshot = {
		at: new Date().toISOString(),
		notes: notes
			.slice(0, MAX_NOTES)
			.map((note) =>
				note.content_markdown.length > MAX_BODY
					? { ...note, content_markdown: note.content_markdown.slice(0, MAX_BODY) }
					: note
			)
	};

	try {
		localStorage.setItem(KEY, JSON.stringify(snapshot));
	} catch {
		// Out of room. The cache is a convenience, never a source of truth —
		// dropping it is always the right call over failing the render.
		try {
			localStorage.removeItem(KEY);
		} catch {
			/* nothing left to try */
		}
	}
}

export function loadStream(): Note[] | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return null;
		const snapshot = JSON.parse(raw) as Snapshot;
		return Array.isArray(snapshot?.notes) ? snapshot.notes : null;
	} catch {
		return null;
	}
}
