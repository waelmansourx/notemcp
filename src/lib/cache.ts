import type { Note, Tag } from './types';

/**
 * The last stream that loaded, kept on this device.
 *
 * This used to be a crash mat: the page was server-rendered, and the cache was
 * only consulted when the query had actually failed, so a flaky connection
 * wouldn't read as "your notes are gone". It's now the thing you normally see.
 * The stream's data is streamed rather than awaited (see +page.server.ts), so
 * the shell paints immediately and this fills it while Supabase is still
 * answering — which is what turns navigating between pages from a round trip
 * into a repaint, and stops the PWA's splash screen from standing in for a
 * database query.
 *
 * The server's answer still wins the moment it lands. Nothing here is a source
 * of truth; it's the copy that means the app is never empty while it waits.
 */
const STREAM_KEY = 'notemcp:stream';
const TAGS_KEY = 'notemcp:tags';

/** The service worker's copy of the last page of each route, cleared alongside
 *  everything else on sign-out (see src/service-worker.ts). */
const PAGE_CACHE = 'notemcp-pages-v1';

// Enough to fill several screens of scrolling. Past that we'd be spending
// the localStorage budget a queued capture might need.
const MAX_NOTES = 120;

// A note carrying an embedded photo is a base64 data URL running to
// megabytes. One of those would blow the whole quota, so oversized bodies are
// stored trimmed — the cached stream only ever renders an excerpt anyway, and
// the note's own page always loads the real thing from the server.
const MAX_BODY = 4_000;

export type TagCount = Tag & { count: number };

interface StreamSnapshot {
	at: string;
	notes: Note[];
}

interface TagSnapshot {
	at: string;
	/** The filter row's tags, with their counts. */
	all: TagCount[];
	/** What the composer and the share sheet offer, most recently used first. */
	recent: Tag[];
}

function read<T>(key: string): T | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

function write(key: string, value: unknown) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Out of room. The cache is a convenience, never a source of truth —
		// dropping it is always the right call over failing the render.
		try {
			localStorage.removeItem(key);
		} catch {
			/* nothing left to try */
		}
	}
}

/* A trimmed note is still openable — the note's own page loads the real body
   from the server — so truncating here costs an excerpt, not a thought.
   Continuations are bodies too, and a thread of them is exactly where a long
   note ends up, so they're trimmed on the way down as well. */
function trim(note: Note): Note {
	const body =
		note.content_markdown.length > MAX_BODY
			? note.content_markdown.slice(0, MAX_BODY)
			: note.content_markdown;
	if (!note.children) return body === note.content_markdown ? note : { ...note, content_markdown: body };
	return { ...note, content_markdown: body, children: note.children.map(trim) };
}

export function saveStream(notes: Note[]) {
	write(STREAM_KEY, {
		at: new Date().toISOString(),
		notes: notes.slice(0, MAX_NOTES).map(trim)
	} satisfies StreamSnapshot);
}

export function loadStream(): Note[] | null {
	const snapshot = read<StreamSnapshot>(STREAM_KEY);
	return Array.isArray(snapshot?.notes) ? snapshot.notes : null;
}

/* The two tag lists are written by different pages — the stream knows the
   counts, the root layout knows the ranking — so each merges into the snapshot
   rather than replacing it, and neither erases the other's half. */
function mergeTags(patch: Partial<Omit<TagSnapshot, 'at'>>) {
	const current = read<TagSnapshot>(TAGS_KEY);
	write(TAGS_KEY, {
		at: new Date().toISOString(),
		all: patch.all ?? current?.all ?? [],
		recent: patch.recent ?? current?.recent ?? []
	} satisfies TagSnapshot);
}

export function saveAllTags(all: TagCount[]) {
	mergeTags({ all });
}

export function saveRecentTags(recent: Tag[]) {
	mergeTags({ recent });
}

export function loadAllTags(): TagCount[] | null {
	const snapshot = read<TagSnapshot>(TAGS_KEY);
	return Array.isArray(snapshot?.all) ? snapshot.all : null;
}

export function loadRecentTags(): Tag[] | null {
	const snapshot = read<TagSnapshot>(TAGS_KEY);
	return Array.isArray(snapshot?.recent) ? snapshot.recent : null;
}

/**
 * Signing out has to take the notes with it. Everything here is written
 * per-device, not per-account, so leaving it behind would hand the next person
 * to sign in on this device a stream of someone else's thoughts to look at
 * until the server's answer replaced it.
 *
 * That includes the service worker's page cache: those are server-rendered
 * pages with notes in them, not just a shell.
 */
export function clearCache() {
	if (typeof localStorage !== 'undefined') {
		for (const key of [STREAM_KEY, TAGS_KEY]) {
			try {
				localStorage.removeItem(key);
			} catch {
				/* nothing left to try */
			}
		}
	}
	if (typeof caches !== 'undefined') caches.delete(PAGE_CACHE).catch(() => {});
}
