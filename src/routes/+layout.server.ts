import type { LayoutServerLoad } from './$types';
import type { GroupStub } from '$lib/types';

/** Enough recent notes to have seen every tag you actually reach for, while
 *  selecting no bodies — an embedded photo is a base64 data URL running to
 *  megabytes and has no business riding along with a chip row. */
const TAG_WINDOW = 60;

/** More than a row's worth would just be a list to read. */
const GROUP_LIMIT = 12;

export const load: LayoutServerLoad = async ({ locals: { session, supabase, user }, cookies }) => {
	// authGuard (hooks.server.ts) already ran safeGetSession() for this
	// request — reuse its result instead of re-verifying with Supabase again,
	// which was adding a second network round-trip to every page load.

	/*
	 * The groups you could be writing into.
	 *
	 * This used to be a list of recent *notes* to continue. The container is
	 * the tag now, so it's a list of tags — loaded here rather than per page so
	 * that every capture surface (the composer, the OS share sheet) offers the
	 * same ones, in the same order, instead of the share sheet falling back to
	 * five hard-coded names.
	 *
	 * Count and last-touched come from the window rather than an aggregate
	 * query: this is a sense of weight for a row of chips, not an audited
	 * total, and it's the same trade the stream's filter row already makes.
	 */
	let recentGroups: GroupStub[] = [];

	if (user) {
		const { data } = await supabase
			.from('notes')
			.select('id, updated_at, note_tags(tags(id, name))')
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.eq('archived', false)
			.order('updated_at', { ascending: false })
			.limit(TAG_WINDOW);

		// Rows arrive last-touched first, so a tag's first sighting is both its
		// last activity and its place in the row: most recently used wins.
		const seen = new Map<string, GroupStub>();
		for (const row of data ?? []) {
			for (const nt of (row as any).note_tags ?? []) {
				const tag = nt.tags;
				if (!tag) continue;
				const found = seen.get(tag.name);
				if (found) found.count += 1;
				else seen.set(tag.name, { name: tag.name, count: 1, at: (row as any).updated_at });
			}
		}
		recentGroups = [...seen.values()].slice(0, GROUP_LIMIT);
	}

	return {
		session,
		cookies: cookies.getAll(),
		recentGroups
	};
};
