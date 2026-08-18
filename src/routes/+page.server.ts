import type { PageServerLoad } from './$types';
import type { Note, Tag } from '$lib/types';

const NOTE_SELECT = '*, note_tags(tags(id, name))';

/** Tags ordered by how recently they were used — that's what "recent" means
 *  in the composer, and it's free to derive from notes we already loaded. */
function recentTagsFrom(notes: Note[]): Tag[] {
	const seen = new Map<string, Tag>();
	for (const note of notes) {
		for (const tag of note.tags) if (!seen.has(tag.id)) seen.set(tag.id, tag);
		if (seen.size >= 12) break;
	}
	return [...seen.values()].slice(0, 8);
}

export const load: PageServerLoad = async ({ locals: { supabase, user } }) => {
	const { data } = await supabase
		.from('notes')
		.select(NOTE_SELECT)
		.eq('user_id', user!.id)
		.is('deleted_at', null)
		.eq('archived', false)
		.order('created_at', { ascending: false })
		.limit(300);

	const notes: Note[] = (data ?? []).map((row: any) => {
		const { note_tags, ...rest } = row;
		return { ...rest, tags: (note_tags ?? []).map((nt: any) => nt.tags).filter(Boolean) };
	});

	return { notes, recentTags: recentTagsFrom(notes) };
};
