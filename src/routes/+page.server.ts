import type { PageServerLoad } from './$types';
import type { Note } from '$lib/types';

const NOTE_SELECT = '*, note_tags(tags(id, name))';

export const load: PageServerLoad = async ({ locals: { supabase, user } }) => {
	const { data } = await supabase
		.from('notes')
		.select(NOTE_SELECT)
		.eq('user_id', user!.id)
		.is('deleted_at', null)
		.eq('archived', false)
		.order('pinned', { ascending: false })
		.order('created_at', { ascending: false })
		.limit(300);

	const notes: Note[] = (data ?? []).map((row: any) => {
		const { note_tags, ...rest } = row;
		return { ...rest, tags: (note_tags ?? []).map((nt: any) => nt.tags).filter(Boolean) };
	});

	return { notes };
};
