import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Note } from '$lib/types';

const NOTE_SELECT = '*, note_tags(tags(id, name))';

export const load: PageServerLoad = async ({ params, locals: { supabase, user } }) => {
	const { data, error: fetchError } = await supabase
		.from('notes')
		.select(NOTE_SELECT)
		.eq('id', params.id)
		.eq('user_id', user!.id)
		.is('deleted_at', null)
		.single();

	if (fetchError || !data) throw error(404, 'Note not found');

	const { note_tags, ...rest } = data as any;
	const note: Note = { ...rest, tags: (note_tags ?? []).map((nt: any) => nt.tags).filter(Boolean) };

	return { note };
};
