import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Tag, ThreadStub } from '$lib/types';
import { normalizeTagName, tagCovers } from '$lib/tags';
import { previewImageFor } from '$lib/preview-image';

const PREVIEW_SELECT =
	'id, title, source_title, source_image, source_url, preview_image, updated_at, thread_count, preview, note_tags(tags(id, name))';

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

function stubOf(row: any): ThreadStub {
	return {
		id: row.id,
		label: label(row),
		image: previewImageFor(row),
		source: hostname(row.source_url ?? null),
		count: row.thread_count ?? 0,
		at: row.updated_at,
		tags: tagsOf(row)
	};
}

export const GET: RequestHandler = async ({ url, locals: { supabase, user } }) => {
	if (!user) throw error(401, 'Not authenticated');

	const name = normalizeTagName(url.searchParams.get('name') ?? '');
	if (!name) throw error(400, 'Tag name is required');

	const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
	const limit = Math.min(18, Math.max(3, Number.parseInt(url.searchParams.get('limit') ?? '9', 10) || 9));

	const { data: tagRows } = await supabase
		.from('tags')
		.select('id, name')
		.eq('user_id', user.id);

	const matching = ((tagRows ?? []) as Tag[]).filter((tag) => tagCovers(name, tag.name));
	if (matching.length === 0) return json({ notes: [], total: 0, hasMore: false });

	const { data: links } = await supabase
		.from('note_tags')
		.select('note_id')
		.in(
			'tag_id',
			matching.map((tag) => tag.id)
		);

	const noteIds = [...new Set((links ?? []).map((link: any) => link.note_id))];
	if (noteIds.length === 0) return json({ notes: [], total: 0, hasMore: false });

	const { data: rows, count, error: queryError } = await supabase
		.from('notes')
		.select(PREVIEW_SELECT, { count: 'exact' })
		.eq('user_id', user.id)
		.is('deleted_at', null)
		.eq('archived', false)
		.in('id', noteIds)
		.order('updated_at', { ascending: false })
		.range(offset, offset + limit - 1);

	if (queryError) throw error(500, 'Could not load tag notes');

	const notes = (rows ?? []).map(stubOf);
	const total = count ?? offset + notes.length;
	return json({ notes, total, hasMore: offset + notes.length < total });
};
