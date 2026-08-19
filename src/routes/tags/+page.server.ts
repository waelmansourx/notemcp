import type { PageServerLoad } from './$types';
import type { Tag, ThreadStub } from '$lib/types';

export type TagGroup = {
	tag: Tag;
	count: number;
	/** The most recent notes carrying this tag — enough to fill the card's
	 *  pages, not the whole tag. */
	notes: ThreadStub[];
};

/** Three rows to a page, three pages: enough that a tag reads as a place with
 *  things in it, few enough that the card stays a card. */
const PER_TAG = 9;

/*
 * This page used to load 500 whole notes and hand each tag the raw
 * `content_markdown` of its most recent one. A note with a photo in it *is* a
 * megabytes-long base64 data URL, so a handful of those went into the HTML as
 * literal text and took the page down with them. It now asks for `preview`, a
 * computed column that trims the body in Postgres, so those bytes never leave
 * the database.
 */
const PREVIEW_SELECT =
	'id, title, source_title, source_image, source_url, updated_at, preview, thread_count';

function label(row: any): string {
	const raw = (row.source_title || row.title || row.preview || '').replace(/\s+/g, ' ').trim();
	if (!raw) return 'Untitled';
	return raw.length > 90 ? raw.slice(0, 89) + '…' : raw;
}

function hostname(url: string | null): string | null {
	if (!url) return null;
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return null;
	}
}

export const load: PageServerLoad = async ({ locals: { supabase, user } }) => {
	const { data: tagRows } = await supabase.from('tags').select('id, name').eq('user_id', user!.id);

	const tags: Tag[] = tagRows ?? [];
	if (tags.length === 0) return { groups: [] as TagGroup[] };

	const { data: links } = await supabase
		.from('note_tags')
		.select('tag_id, note_id')
		.in(
			'tag_id',
			tags.map((t) => t.id)
		);

	const noteIds = [...new Set((links ?? []).map((l: any) => l.note_id))];
	if (noteIds.length === 0) return { groups: [] as TagGroup[] };

	const { data: noteRows } = await supabase
		.from('notes')
		.select(PREVIEW_SELECT)
		.eq('user_id', user!.id)
		.is('deleted_at', null)
		.eq('archived', false)
		.in('id', noteIds)
		.order('updated_at', { ascending: false });

	const stubs = new Map<string, ThreadStub>();
	const rank = new Map<string, number>();
	(noteRows ?? []).forEach((row: any, i) => {
		stubs.set(row.id, {
			id: row.id,
			label: label(row),
			image: row.source_image ?? null,
			source: hostname(row.source_url ?? null),
			count: row.thread_count ?? 0,
			at: row.updated_at
		});
		rank.set(row.id, i);
	});

	const byTag = new Map<string, string[]>();
	for (const link of links ?? []) {
		if (!stubs.has(link.note_id)) continue;
		const list = byTag.get(link.tag_id);
		if (list) list.push(link.note_id);
		else byTag.set(link.tag_id, [link.note_id]);
	}

	const groups: TagGroup[] = tags
		.map((tag) => {
			const ids = (byTag.get(tag.id) ?? []).sort(
				(a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9)
			);
			return {
				tag,
				count: ids.length,
				notes: ids.slice(0, PER_TAG).map((id) => stubs.get(id)!)
			};
		})
		.filter((g) => g.count > 0)
		// Most recently touched tag first: the thing you're in the middle of is
		// the thing you're most likely to be looking for.
		.sort((a, b) => (b.notes[0]?.at ?? '').localeCompare(a.notes[0]?.at ?? ''));

	return { groups };
};
