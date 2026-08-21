import type { PageServerLoad } from './$types';
import type { Note, Tag } from '$lib/types';
import { attachChildren } from '$lib/thread';
import { normalizeTagName, tagCovers } from '$lib/tags';

const NOTE_SELECT = '*, note_tags(tags(id, name))';

export const load: PageServerLoad = async ({ params, locals: { supabase, user } }) => {
	const name = normalizeTagName(params.name);

	const { data: tagRows } = await supabase
		.from('tags')
		.select('id, name')
		.eq('user_id', user!.id);

	const matching = ((tagRows ?? []) as Tag[]).filter((tag) => tagCovers(name, tag.name));
	if (matching.length === 0) return { name, notes: [] as Note[] };

	const { data: links } = await supabase
		.from('note_tags')
		.select('note_id')
		.in(
			'tag_id',
			matching.map((tag) => tag.id)
		);

	const noteIds = [...new Set((links ?? []).map((link: any) => link.note_id))];
	if (noteIds.length === 0) return { name, notes: [] as Note[] };

	const { data: rows } = await supabase
		.from('notes')
		.select(NOTE_SELECT)
		.eq('user_id', user!.id)
		.is('deleted_at', null)
		.eq('archived', false)
		.in('id', noteIds)
		.order('updated_at', { ascending: false });

	const notes: Note[] = (rows ?? []).map((row: any) => {
		const { note_tags, ...rest } = row;
		return { ...rest, tags: (note_tags ?? []).map((nt: any) => nt.tags).filter(Boolean) };
	});

	return { name, notes: attachChildren(notes) };
};
