import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Note } from '$lib/types';

const NOTE_SELECT = '*, note_tags(tags(id, name))';

function hydrate(row: any): Note {
	const { note_tags, ...rest } = row;
	return { ...rest, tags: (note_tags ?? []).map((nt: any) => nt.tags).filter(Boolean) };
}

export const load: PageServerLoad = async ({ params, locals: { supabase, user } }) => {
	const { data, error: fetchError } = await supabase
		.from('notes')
		.select(NOTE_SELECT)
		.eq('id', params.id)
		.eq('user_id', user!.id)
		.is('deleted_at', null)
		.single();

	if (fetchError || !data) throw error(404, 'Note not found');

	const note = hydrate(data);

	/*
	 * The whole thread, not just what hangs off this note.
	 *
	 * `parent_id` is really a thread id that the first thought leaves null, so
	 * the members of a thread are "the head, plus everything pointing at it" —
	 * which is one query regardless of which thought you opened. The previous
	 * version only fetched *children*, so opening the second thought in a
	 * thread showed none of its siblings: the first thought was the only one
	 * that could see the rest. That asymmetry is what made a thread read as a
	 * note with comments rather than as a sequence of equal thoughts.
	 */
	const threadId = note.parent_id ?? note.id;

	const { data: members } = await supabase
		.from('notes')
		.select(NOTE_SELECT)
		.eq('user_id', user!.id)
		.is('deleted_at', null)
		.or(`id.eq.${threadId},parent_id.eq.${threadId}`)
		.order('created_at', { ascending: true });

	// Read as it was written. Falls back to just this note if the thread query
	// failed — a page that shows one thought is better than one that 500s.
	const thread: Note[] = (members ?? []).map(hydrate);

	return { note, thread: thread.length > 0 ? thread : [note] };
};
