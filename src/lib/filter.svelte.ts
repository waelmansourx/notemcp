import type { Note } from './types';
import { plainText } from './markdown';
import { tagMatchesSearch } from './tags';

/**
 * Filtering the stream.
 *
 * Tags used to be a separate tab with its own list layout and its own
 * per-tag page — two more screens to maintain, and a dead end once you were
 * in one. They're a filter now: same stream, fewer notes. Search works the
 * same way, on the same bar, and the two combine.
 *
 * Active tags live in the URL (`/?tag=blog&tag=idea`) so a filtered view is
 * something you can link to and come back to. The text query is deliberately
 * transient — it's a way of finding one thing right now, not a place.
 */
export const filter = $state<{ open: boolean; q: string }>({ open: false, q: '' });

export function openFilter() {
	filter.open = true;
}

export function closeFilter() {
	filter.open = false;
	filter.q = '';
}

export function toggleFilter() {
	if (filter.open) closeFilter();
	else openFilter();
}

/** Every word in the query has to appear somewhere in the note. Cheap, and it
 *  behaves the way people expect a search box to behave. */
export function matchesQuery(note: Note, q: string): boolean {
	const needle = q.trim().toLowerCase();
	if (!needle) return true;

	const haystack = [
		note.title,
		plainText(note.content_markdown),
		note.source_title,
		note.source_description,
		note.source_url,
		...note.tags.map((t) => `#${t.name}`)
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();

	return needle.split(/\s+/).every((word) => haystack.includes(word));
}

/** A note has to carry every active tag, not just one of them — narrowing is
 *  the point of picking a second tag.
 *
 *  A tag stands for any run of levels it names, in either direction:
 *  `#notemcp` finds `#notemcp/bug/share` because it's the branch above it, and
 *  `#bug` finds it too, because a type you use across projects should be one
 *  filter rather than one per project. */
export function matchesTags(note: Note, tags: string[]): boolean {
	if (tags.length === 0) return true;
	const own = note.tags.map((t) => t.name);
	return tags.every((t) => own.some((name) => tagMatchesSearch(t, name)));
}

/** A thread matches if any thought in it does — the head, or anything added
 *  to it since. Tagging the fourth thought in a thread has to be enough to
 *  find the thread, and the whole thing then stays intact on screen rather
 *  than being cut down to the one line that matched. */
function threadMatches(note: Note, tags: string[], q: string): boolean {
	if (matchesTags(note, tags) && matchesQuery(note, q)) return true;
	return (note.children ?? []).some((c) => matchesTags(c, tags) && matchesQuery(c, q));
}

export function applyFilter(notes: Note[], tags: string[], q: string): Note[] {
	if (tags.length === 0 && !q.trim()) return notes;
	return notes.filter((n) => threadMatches(n, tags, q));
}
