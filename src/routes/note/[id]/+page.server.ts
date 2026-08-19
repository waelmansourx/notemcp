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

	/* The rest of the thread. Opening a note has to show everything that was
	   added to it — the stream expands a thread in place, so arriving here and
	   finding only the first thought would read as having lost the others. */
	const [thoughtsResult, parentResult] = await Promise.all([
		supabase
			.from('notes')
			.select(NOTE_SELECT)
			.eq('user_id', user!.id)
			.eq('parent_id', note.id)
			.is('deleted_at', null)
			.order('created_at', { ascending: true }),
		note.parent_id
			? supabase
					.from('notes')
					.select('id, title, source_title, preview')
					.eq('user_id', user!.id)
					.eq('id', note.parent_id)
					.maybeSingle()
			: Promise.resolve({ data: null })
	]);

	const thoughts: Note[] = (thoughtsResult.data ?? []).map((row: any) => {
		const { note_tags: kidTags, ...kid } = row;
		return { ...kid, tags: (kidTags ?? []).map((nt: any) => nt.tags).filter(Boolean) };
	});

	// A continuation says what it belongs to, so you're never looking at a
	// fragment with no way back to the thought it came from.
	const head = parentResult.data as any;
	const parent = head
		? {
				id: head.id as string,
				label: ((head.source_title || head.title || head.preview || 'Untitled') as string).slice(
					0,
					60
				)
			}
		: null;

	return { note, thoughts, parent };
};
