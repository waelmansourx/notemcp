import type { LayoutServerLoad } from './$types';
import type { Tag } from '$lib/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Enough recent notes to rank most of a normal user's tags by when they were
 *  last reached for, still selecting no bodies. */
const TAG_WINDOW = 200;

/** How many tags the composer's chip row and its typeahead get to search
 *  over. Past this it's scroll-the-list territory anyway. */
const TAG_SUGGEST_LIMIT = 60;

/* The tags you've reached for lately, plus everything else you've ever made —
   ranked, not just windowed. Loaded in the root layout rather than on the
   stream page so that every capture surface — the composer and the OS share
   sheet — offers the same row, instead of the share sheet falling back to five
   hard-coded ones.

   A tag you set up last week and haven't touched since used to fall out of the
   row entirely once 40 more recent notes pushed it out of the window — which
   meant the composer's suggestions and the typeahead built on top of them
   (TagPicker) could only ever offer what you'd just used, not what you
   actually have. This still ranks by recency of use first, it just doesn't
   drop the rest: an unused tag sorts after the ranked ones instead of
   vanishing. */
async function rankTags(supabase: SupabaseClient, userId: string): Promise<Tag[]> {
	const [allTagsResult, usageResult] = await Promise.all([
		supabase.from('tags').select('id, name').eq('user_id', userId),
		supabase
			.from('notes')
			.select('id, note_tags(tags(id, name))')
			.eq('user_id', userId)
			.is('deleted_at', null)
			.order('updated_at', { ascending: false })
			.limit(TAG_WINDOW)
	]);

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

	// Anything that didn't show up in the usage window — created, never used
	// again, or just older than TAG_WINDOW notes back — goes after the ranked
	// ones rather than being invisible.
	const unranked = (allTagsResult.data ?? [])
		.filter((t: any) => !seen.has(t.id))
		.sort((a: any, b: any) => a.name.localeCompare(b.name));

	return [...ranked, ...unranked].slice(0, TAG_SUGGEST_LIMIT);
}

export const load: LayoutServerLoad = async ({ locals: { session, supabase, user }, cookies }) => {
	// authGuard (hooks.server.ts) already ran safeGetSession() for this
	// request — reuse its result instead of re-verifying with Supabase again,
	// which was adding a second network round-trip to every page load.

	return {
		session,
		cookies: cookies.getAll(),

		/*
		 * Deliberately not awaited. This load runs on every navigation, in
		 * every route, so anything awaited here is a Supabase round trip
		 * standing between tapping a link and seeing the next page — which is
		 * most of what made moving around the app feel like using a website
		 * rather than an app. Returned as a promise, it streams: the page
		 * renders now and the row updates when the answer arrives, which the
		 * composer never notices because it reads the row from the local cache
		 * (see $lib/cache.svelte) rather than from here.
		 *
		 * Rejections have to be swallowed rather than propagated: a failed tag
		 * query is a stale suggestion row, not a reason to replace the page
		 * you asked for with an error. It resolves to `null` rather than `[]`
		 * so the client can tell "we couldn't ask" — keep showing the cached
		 * row — apart from "you have no tags", which really should empty it.
		 */
		recentTags: user
			? rankTags(supabase, user.id).catch(() => null)
			: Promise.resolve([] as Tag[])
	};
};
