import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Note, Tag } from '$lib/types';

const NOTE_SELECT = '*, note_tags(tags(id, name))';

export const load: PageServerLoad = async ({ params, locals: { supabase, user } }) => {
	const name = decodeURIComponent(params.name).toLowerCase();

	const { data: tag } = await supabase
		.from('tags')
		.select('id, name')
		.eq('user_id', user!.id)
		.eq('name', name)
		.maybeSingle();

	if (!tag) throw error(404, 'No such tag');

	const { data: links } = await supabase.from('note_tags').select('note_id').eq('tag_id', tag.id);
	const ids = (links ?? []).map((l: any) => l.note_id);

	if (ids.length === 0) return { tag: tag as Tag, notes: [] as Note[] };

	const { data } = await supabase
		.from('notes')
		.select(NOTE_SELECT)
		.eq('user_id', user!.id)
		.is('deleted_at', null)
		.eq('archived', false)
		.in('id', ids)
		.order('pinned', { ascending: false })
		.order('created_at', { ascending: false });

	const notes: Note[] = (data ?? []).map((row: any) => {
		const { note_tags, ...rest } = row;
		return { ...rest, tags: (note_tags ?? []).map((nt: any) => nt.tags).filter(Boolean) };
	});

	return { tag: tag as Tag, notes };
};
