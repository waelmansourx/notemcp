import type { PageServerLoad } from './$types';
import type { Tag, ThreadStub } from '$lib/types';
import { flattenTagTree, tagAncestors, tagTree } from '$lib/tags';
import { previewImageFor } from '$lib/preview-image';

/**
 * One row of the tag tree.
 *
 * A tag's card counts everything filed beneath it, not only what carries it
 * exactly — `#notemcp` shows the thought you tagged `#notemcp/bug/share`,
 * which is the same rule the stream filter uses. That's what makes a parent
 * worth tapping, and what lets you tag one specific path without losing the
 * broad view.
 *
 * Levels nothing was tagged with exactly still get a row (see tagTree), so
 * `#notemcp` is a place even if every note went under `#notemcp/bug`.
 */
export type TagTreeGroup = {
	/** The full path, and the tag's stored name. */
	name: string;
	/** Just this level, for a card sitting under its parent. */
	leaf: string;
	depth: number;
	/** The real tag row's id where one exists, so keys stay stable; a
	 *  synthesised parent falls back to its path. */
	id: string;
	count: number;
	/** The most recent notes filed under this path — enough to fill the card's
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
 * literal text and took the page down with them. It now asks for computed
 * preview fields: `preview` for text and `preview_image` for the first stable
 * thumbnail, so the note body never has to leave Postgres just to draw a shelf.
 *
 * Deploys are not atomic with database migrations, though. If the app reaches
 * a database whose PostgREST schema does not know `preview_image` yet, selecting
 * it makes the *entire notes query* fail. The legacy select below is therefore
 * an intentional compatibility path: tags stay visible immediately, with
 * source/YouTube thumbnails, and embedded-image thumbnails appear as soon as
 * the migration is available.
 */
const PREVIEW_SELECT =
	'id, title, source_title, source_image, source_url, preview_image, updated_at, thread_count, preview, note_tags(tags(id, name))';
const LEGACY_PREVIEW_SELECT =
	'id, title, source_title, source_image, source_url, updated_at, thread_count, preview, note_tags(tags(id, name))';

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

function tagsOf(row: any): Tag[] {
	return (row.note_tags ?? []).map((nt: any) => nt.tags).filter(Boolean);
}

export const load: PageServerLoad = async ({ locals: { supabase, user } }) => {
	const { data: tagRows } = await supabase.from('tags').select('id, name').eq('user_id', user!.id);

	const tags: Tag[] = tagRows ?? [];
	if (tags.length === 0) return { nodes: [] as TagTreeGroup[] };

	const { data: links } = await supabase
		.from('note_tags')
		.select('tag_id, note_id')
		.in(
			'tag_id',
			tags.map((t) => t.id)
		);

	const noteIds = [...new Set((links ?? []).map((l: any) => l.note_id))];
	if (noteIds.length === 0) return { nodes: [] as TagTreeGroup[] };

	const queryNotes = (select: string) =>
		supabase
			.from('notes')
			.select(select)
			.eq('user_id', user!.id)
			.is('deleted_at', null)
			.eq('archived', false)
			.in('id', noteIds)
			.order('updated_at', { ascending: false });

	let noteResult = await queryNotes(PREVIEW_SELECT);
	if (noteResult.error) noteResult = await queryNotes(LEGACY_PREVIEW_SELECT);
	const noteRows = noteResult.data ?? [];

	const stubs = new Map<string, ThreadStub>();
	const rank = new Map<string, number>();
	noteRows.forEach((row: any, i) => {
		stubs.set(row.id, {
			id: row.id,
			label: label(row),
			image: previewImageFor(row),
			source: hostname(row.source_url ?? null),
			count: row.thread_count ?? 0,
			at: row.updated_at,
			tags: tagsOf(row)
		});
		rank.set(row.id, i);
	});

	// A note files under every level of every tag it carries, so a parent's
	// card is the union of its children's. Deduped per path: two tags under
	// the same parent must not list the note twice.
	const byPath = new Map<string, string[]>();
	for (const [noteId, stub] of stubs) {
		const paths = new Set<string>();
		for (const tag of stub.tags) for (const path of tagAncestors(tag.name)) paths.add(path);
		for (const path of paths) {
			const list = byPath.get(path);
			if (list) list.push(noteId);
			else byPath.set(path, [noteId]);
		}
	}

	const idByName = new Map(tags.map((t) => [t.name, t.id] as const));

	// Most recently touched first: the thing you're in the middle of is the
	// thing you're most likely to be looking for. Ordering the *names* this
	// way before building the tree is what carries recency into it, since
	// tagTree keeps whatever order it's given at every level.
	const ordered = [...byPath.keys()].sort((a, b) => {
		const an = byPath.get(a)!.reduce((m, id) => Math.min(m, rank.get(id) ?? 1e9), 1e9);
		const bn = byPath.get(b)!.reduce((m, id) => Math.min(m, rank.get(id) ?? 1e9), 1e9);
		return an - bn;
	});

	const nodes: TagTreeGroup[] = flattenTagTree(tagTree(ordered)).map((node) => {
		const ids = (byPath.get(node.name) ?? []).sort(
			(a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9)
		);
		return {
			name: node.name,
			leaf: node.leaf,
			depth: node.depth,
			id: idByName.get(node.name) ?? `path:${node.name}`,
			count: ids.length,
			notes: ids.slice(0, PER_TAG).map((id) => stubs.get(id)!)
		};
	});

	return { nodes };
};
