import type { LayoutServerLoad } from './$types';
import type { Tag, ThreadStub } from '$lib/types';

/* Only what a strip of cards needs: no bodies, so a captured photo's base64
   data URL never rides along. `preview` and `thread_count` are computed
   columns on the notes table. Tags ride along too — a continuation inherits
   whatever the thread it's joining is already tagged with (composer.svelte.ts
   `attach`), so the stub needs to carry them, not just the note. */
const STUB_SELECT =
	'id, title, source_title, source_image, source_url, updated_at, thread_count, preview, note_tags(tags(id, name))';

const RECENT_LIMIT = 8;

/** Enough recent notes to rank most of a normal user's tags by when they were
 *  last reached for, still selecting no bodies. */
const TAG_WINDOW = 200;

/** How many tags the composer's chip row and its typeahead get to search
 *  over. Past this it's scroll-the-list territory anyway. */
const TAG_SUGGEST_LIMIT = 60;

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

function tagsOf(row: any): Tag[] {
	return (row.note_tags ?? []).map((nt: any) => nt.tags).filter(Boolean);
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

	/* The tags you've reached for lately, plus everything else you've ever
	   made — ranked, not just windowed. Loaded here rather than on the
	   stream page so that every capture surface — the composer and the OS
	   share sheet — offers the same row, instead of the share sheet falling
	   back to five hard-coded ones.

	   A tag you set up last week and haven't touched since used to fall out
	   of the row entirely once 40 more recent notes pushed it out of the
	   window — which meant the composer's suggestions and the typeahead
	   built on top of them (TagPicker) could only ever offer what you'd just
	   used, not what you actually have. This still ranks by recency of use
	   first, it just doesn't drop the rest: an unused tag sorts after the
	   ranked ones instead of vanishing. */
	let recentTags: Tag[] = [];

	if (user) {
		const [threadsResult, allTagsResult, usageResult] = await Promise.all([
			supabase
				.from('notes')
				.select(STUB_SELECT)
				.eq('user_id', user.id)
				.is('deleted_at', null)
				.is('parent_id', null)
				.eq('archived', false)
				.order('updated_at', { ascending: false })
				.limit(RECENT_LIMIT),
			supabase.from('tags').select('id, name').eq('user_id', user.id),
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
			at: row.updated_at,
			tags: tagsOf(row)
		}));

		// Most recently used first, deduped — the order the rows came back in
		// is already "last touched", so first sighting wins.
		const seen = new Set<string>();
		const ranked: Tag[] = [];
		for (const row of usageResult.data ?? []) {
			for (const nt of (row as any).note_tags ?? []) {
				const tag = nt.tags;
				if (tag && !seen.has(tag.id)) {
					seen.add(tag.id);
					ranked.push({ id: tag.id, name: tag.name });
				}
			}
		}

		// Anything that didn't show up in the usage window — created, never
		// used again, or just older than TAG_WINDOW notes back — goes after
		// the ranked ones rather than being invisible.
		const unranked = (allTagsResult.data ?? [])
			.filter((t: any) => !seen.has(t.id))
			.sort((a: any, b: any) => a.name.localeCompare(b.name));

		recentTags = [...ranked, ...unranked].slice(0, TAG_SUGGEST_LIMIT);
	}

	return {
		session,
		cookies: cookies.getAll(),
		recentThreads,
		recentTags
	};
};
