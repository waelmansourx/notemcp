import type { PageServerLoad } from './$types';
import type { Note, Tag } from '$lib/types';

const NOTE_SELECT = '*, note_tags(tags(id, name))';

export interface TagSummary {
	tag: Tag;
	/** The most recent thought carrying this tag — a preview, not a count. */
	last: string;
	thumbs: string[];
	updatedAt: string;
}

export const load: PageServerLoad = async ({ locals: { supabase, user } }) => {
	const { data } = await supabase
		.from('notes')
		.select(NOTE_SELECT)
		.eq('user_id', user!.id)
		.is('deleted_at', null)
		.eq('archived', false)
		.order('created_at', { ascending: false })
		.limit(500);

	const notes: Note[] = (data ?? []).map((row: any) => {
		const { note_tags, ...rest } = row;
		return { ...rest, tags: (note_tags ?? []).map((nt: any) => nt.tags).filter(Boolean) };
	});

	const summaries = new Map<string, TagSummary>();
	for (const note of notes) {
		const preview = (note.source_title || note.content_markdown || note.title || '').trim();
		for (const tag of note.tags) {
			let summary = summaries.get(tag.id);
			if (!summary) {
				summary = { tag, last: preview, thumbs: [], updatedAt: note.created_at };
				summaries.set(tag.id, summary);
			}
			if (note.source_image && summary.thumbs.length < 4) summary.thumbs.push(note.source_image);
		}
	}

	// Notes arrive newest-first, so insertion order is already recency order.
	return { tags: [...summaries.values()] };
};
