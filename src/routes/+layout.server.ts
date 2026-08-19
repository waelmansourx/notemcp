import type { LayoutServerLoad } from './$types';
import type { Tag, ThreadStub } from '$lib/types';

/* Only what a strip of cards needs: no bodies, so a captured photo's base64
   data URL never rides along. `preview` and `thread_count` are computed
   columns on the notes table. */
const STUB_SELECT =
	'id, title, source_title, source_image, source_url, updated_at, preview, thread_count';

const RECENT_LIMIT = 8;

/** Enough recent notes to have seen every tag you actually reach for, still
 *  selecting no bodies. */
const TAG_WINDOW = 40;

function label(row: any): string {
	const raw = (row.source_title || row.title || row.preview || '').replace(/\s+/g, ' ').trim();
	if (!raw) return 'Untitled';
	return raw.length > 60 ? raw.slice(0, 59) + '…' : raw;
}

function hostname(url: string | null): string | null {
	if (!url) return null;
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return null;
	}
}

export const load: LayoutServerLoad = async ({ locals: { session, supabase, user }, cookies }) => {
	// authGuard (hooks.server.ts) already ran safeGetSession() for this
	// request — reuse its result instead of re-verifying with Supabase again,
	// which was adding a second network round-trip to every page load.

	/*
	 * The threads you could be writing into, loaded here rather than per page
	 * so the composer offers the same ones wherever it is on screen. Heads of
	 * threads only: you continue a thought, never a continuation.
	 */
	let recentThreads: ThreadStub[] = [];

	/* The tags you've reached for lately. Loaded here rather than on the
	   stream page so that every capture surface — the composer and the OS
	   share sheet — offers the same row, instead of the share sheet falling
	   back to five hard-coded ones. */
	let recentTags: Tag[] = [];

	if (user) {
		const [threadsResult, tagsResult] = await Promise.all([
			supabase
				.from('notes')
				.select(STUB_SELECT)
				.eq('user_id', user.id)
				.is('deleted_at', null)
				.is('parent_id', null)
				.eq('archived', false)
				.order('updated_at', { ascending: false })
				.limit(RECENT_LIMIT),
			supabase
				.from('notes')
				.select('id, note_tags(tags(id, name))')
				.eq('user_id', user.id)
				.is('deleted_at', null)
				.order('updated_at', { ascending: false })
				.limit(TAG_WINDOW)
		]);

		recentThreads = (threadsResult.data ?? []).map((row: any) => ({
			id: row.id,
			label: label(row),
			image: row.source_image ?? null,
			source: hostname(row.source_url ?? null),
			count: row.thread_count ?? 0,
			at: row.updated_at
		}));

		// Most recently used first, deduped — the order the rows came back in
		// is already "last touched", so first sighting wins.
		const seen = new Map<string, Tag>();
		for (const row of tagsResult.data ?? []) {
			for (const nt of (row as any).note_tags ?? []) {
				const tag = nt.tags;
				if (tag && !seen.has(tag.id)) seen.set(tag.id, { id: tag.id, name: tag.name });
			}
		}
		recentTags = [...seen.values()].slice(0, 10);
	}

	return {
		session,
		cookies: cookies.getAll(),
		recentThreads,
		recentTags
	};
};
