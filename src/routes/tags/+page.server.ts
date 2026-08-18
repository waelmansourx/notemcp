import type { PageServerLoad } from './$types';
import type { Tag } from '$lib/types';

export type TagSummary = {
	tag: Tag;
	count: number;
	/** The most recent thought carrying this tag — a preview, not a count. */
	last: string;
	lastAt: string | null;
};

/*
 * This page used to load 500 whole notes and hand each tag the raw
 * `content_markdown` of its most recent one. A note with a photo in it *is* a
 * megabytes-long base64 data URL, so a handful of those went into the HTML as
 * literal text and took the page down with them. It now asks for the columns a
 * preview actually needs, and turns markdown into prose before it goes near
 * the DOM.
 */
const PREVIEW_SELECT = 'id, title, source_title, content_markdown, updated_at, created_at';

export const load: PageServerLoad = async ({ locals: { supabase, user } }) => {
	const { data: tagRows } = await supabase.from('tags').select('id, name').eq('user_id', user!.id);

	const tags: Tag[] = tagRows ?? [];
	if (tags.length === 0) return { tags: [] as TagSummary[] };

	const { data: links } = await supabase
		.from('note_tags')
		.select('tag_id, note_id')
		.in(
			'tag_id',
			tags.map((t) => t.id)
		);

	const noteIds = [...new Set((links ?? []).map((l: any) => l.note_id))];
	if (noteIds.length === 0) return { tags: [] as TagSummary[] };

	const { data: noteRows } = await supabase
		.from('notes')
		.select(PREVIEW_SELECT)
		.eq('user_id', user!.id)
		.is('deleted_at', null)
		.eq('archived', false)
		.in('id', noteIds)
		.order('updated_at', { ascending: false });

	const notes = new Map<string, any>();
	const order: string[] = [];
	for (const row of noteRows ?? []) {
		notes.set(row.id, row);
		order.push(row.id);
	}

	const byTag = new Map<string, string[]>();
	for (const link of links ?? []) {
		if (!notes.has(link.note_id)) continue;
		const list = byTag.get(link.tag_id);
		if (list) list.push(link.note_id);
		else byTag.set(link.tag_id, [link.note_id]);
	}

	const rank = new Map(order.map((id, i) => [id, i]));

	const summaries: TagSummary[] = tags
		.map((tag) => {
			const ids = (byTag.get(tag.id) ?? []).sort(
				(a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9)
			);
			const newest = ids.length > 0 ? notes.get(ids[0]) : null;
			return {
				tag,
				count: ids.length,
				last: newest ? newest.source_title || newest.title || newest.content_markdown || '' : '',
				lastAt: newest ? (newest.updated_at ?? newest.created_at) : null
			};
		})
		.filter((s) => s.count > 0)
		.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));

	return { tags: summaries };
};
