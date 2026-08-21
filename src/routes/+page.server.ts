import type { PageServerLoad } from './$types';
import type { Note } from '$lib/types';
import type { TagCount } from '$lib/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { attachChildren } from '$lib/thread';
import { tagAncestors } from '$lib/tags';
import { NOTE_SELECT, normalizeNote } from '$lib/server/notes';

export type { TagCount };

export interface StreamPayload {
	notes: Note[];
	allTags: TagCount[];
	/** `false` means the query failed, as opposed to "you have no notes" — the
	 *  page keeps showing its local copy rather than telling you it's empty. */
	ok: boolean;
}

async function loadStream(supabase: SupabaseClient, userId: string): Promise<StreamPayload> {
	const [notesResult, tagsResult] = await Promise.all([
		supabase
			.from('notes')
			.select(NOTE_SELECT)
			.eq('user_id', userId)
			.is('deleted_at', null)
			.eq('archived', false)
			// Last activity, not creation: editing an old note brings it back to
			// the top of the stream, where you just put your attention.
			.order('updated_at', { ascending: false })
			.limit(300),
		supabase.from('tags').select('id, name').eq('user_id', userId)
	]);

	const notes: Note[] = (notesResult.data ?? []).map(normalizeNote);

	/*
	 * Counts come from the loaded window rather than a second aggregate query:
	 * they're a sense of weight for the filter row, not an audited total.
	 *
	 * Counted by *path*, so a thought tagged `#notemcp/bug/share` counts once
	 * against `#notemcp`, once against `#notemcp/bug` and once against the
	 * full tag. That's what makes a parent tappable: it's offered here even
	 * when no note carries it exactly and no row for it exists in `tags`,
	 * because filtering by it will find things (see matchesTags).
	 *
	 * A note carrying two tags under the same parent still only counts once
	 * for that parent — the number means "thoughts you'd see", not "tags".
	 */
	const counts = new Map<string, number>();
	for (const note of notes) {
		const paths = new Set<string>();
		for (const tag of note.tags) for (const path of tagAncestors(tag.name)) paths.add(path);
		for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1);
	}

	// Real rows first so a tag that exists keeps its id; anything left is a
	// parent that only exists as a prefix of its children.
	const byName = new Map<string, string>();
	for (const t of (tagsResult.data ?? []) as any[]) byName.set(t.name, t.id);

	const allTags: TagCount[] = [...counts.entries()]
		.map(([name, count]) => ({ id: byName.get(name) ?? `path:${name}`, name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

	// Continuations arrive in the same list as everything else — they're
	// ordinary notes — and are folded into the thoughts they continue here, so
	// the stream is a list of threads rather than a list of fragments.
	return { notes: attachChildren(notes), allTags, ok: !notesResult.error };
}

/*
 * Note: this load deliberately never touches `url`. The stream's tag filter
 * lives in the query string (/?tag=blog), and because nothing here reads it,
 * SvelteKit doesn't re-run this load when it changes — filtering is a local
 * re-render rather than a round trip, while still being a real, linkable URL.
 */
export const load: PageServerLoad = async ({ locals: { supabase, user } }) => {
	/*
	 * Streamed, not awaited: the shell — masthead, filter row, composer —
	 * renders straight away, and the notes arrive in it. Two of the open bugs
	 * were really the same one, that this app was Supabase-first on read. On a
	 * cold PWA launch the OS splash screen was standing in for a database
	 * query, and every navigation paid for one before anything moved.
	 *
	 * The page renders its own local copy of the last stream while this is in
	 * flight (see $lib/cache.svelte), so in practice the notes are already
	 * there on the paint after hydration and the server's answer replaces them
	 * quietly. First run on a device is the only time you watch it load.
	 */
	return {
		stream: loadStream(supabase, user!.id).catch((): StreamPayload => ({
			notes: [],
			allTags: [],
			ok: false
		}))
	};
};
