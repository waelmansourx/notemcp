import type { PageServerLoad } from './$types';
import type { Note, Tag } from '$lib/types';

const NOTE_SELECT = '*, note_tags(tags(id, name))';

export type TagCount = Tag & { count: number };

/*
 * Note: this load deliberately never touches `url`. The stream's tag filter
 * lives in the query string (/?tag=blog), and because nothing here reads it,
 * SvelteKit doesn't re-run this load when it changes — filtering is a local
 * re-render rather than a round trip, while still being a real, linkable URL.
 */
export const load: PageServerLoad = async ({ locals: { supabase, user } }) => {
	const [notesResult, tagsResult] = await Promise.all([
		supabase
			.from('notes')
			.select(NOTE_SELECT)
			.eq('user_id', user!.id)
			.is('deleted_at', null)
			.eq('archived', false)
			// Last activity, not creation: editing an old note brings it back to
			// the top of the stream, where you just put your attention.
			.order('updated_at', { ascending: false })
			.limit(300),
		supabase.from('tags').select('id, name').eq('user_id', user!.id)
	]);

	const notes: Note[] = (notesResult.data ?? []).map((row: any) => {
		const { note_tags, ...rest } = row;
		return { ...rest, tags: (note_tags ?? []).map((nt: any) => nt.tags).filter(Boolean) };
	});

	// Counts come from the loaded window rather than a second aggregate query:
	// they're a sense of weight for the filter row, not an audited total.
	const counts = new Map<string, number>();
	for (const note of notes) {
		for (const tag of note.tags) counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1);
	}

	const allTags: TagCount[] = (tagsResult.data ?? [])
		.map((t: any) => ({ id: t.id, name: t.name, count: counts.get(t.id) ?? 0 }))
		.filter((t) => t.count > 0)
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

	// The stream is flat, and deliberately: it's every thought in the order you
	// had them. Grouping lives on the tag — /tags for the containers, /?tag=x
	// for one of them — rather than being folded into the river, which is what
	// made some notes read as headings with other notes filed underneath.
	//
	// `ok: false` means the query failed rather than "you have no notes" — the
	// page uses it to fall back to its local copy instead of telling you the
	// stream is empty.
	//
	// `recentGroups` comes from the root layout, so every capture surface
	// offers the same row rather than each page deriving its own.
	return { notes, allTags, ok: !notesResult.error };
};
