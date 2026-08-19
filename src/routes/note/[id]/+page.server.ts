import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Note } from '$lib/types';
import { groupsOf, oldestFirst, primaryGroup } from '$lib/group';

const NOTE_SELECT = '*, note_tags(tags(id, name))';

/** How much of a group the editor holds at once. A group has no ceiling —
 *  `#idea` will run to hundreds — but the page it renders into does, and every
 *  row here carries a full body that may be a base64 photo. */
const WINDOW = 30;

function hydrate(row: any): Note {
	const { note_tags, ...rest } = row;
	return { ...rest, tags: (note_tags ?? []).map((nt: any) => nt.tags).filter(Boolean) };
}

export const load: PageServerLoad = async ({ params, url, locals: { supabase, user } }) => {
	const { data, error: fetchError } = await supabase
		.from('notes')
		.select(NOTE_SELECT)
		.eq('id', params.id)
		.eq('user_id', user!.id)
		.is('deleted_at', null)
		.single();

	if (fetchError || !data) throw error(404, 'Note not found');

	const note = hydrate(data);

	/*
	 * The group this note is read inside.
	 *
	 * This used to be "the note it hangs off, plus everything else hanging off
	 * that" — which meant one thought was the document and the others were
	 * comments on it. The container is the tag now: the peers are simply the
	 * other notes carrying it, in the order they were written, and the only
	 * thing special about this one is that it's the one you're editing.
	 *
	 * A note with three tags is in three groups, so which one you're looking at
	 * comes from the URL (?group=dental) and defaults to its first.
	 */
	const groups = groupsOf(note);
	const group = primaryGroup(note, url.searchParams.get('group'));
	const tagId = group ? (note.tags.find((t) => t.name === group)?.id ?? null) : null;

	let peers: Note[] = [note];
	let total = 1;

	if (tagId) {
		const { data: links } = await supabase.from('note_tags').select('note_id').eq('tag_id', tagId);

		const ids = [...new Set((links ?? []).map((l: any) => l.note_id as string))];
		total = ids.length;

		if (ids.length > 1) {
			// Newest first for the limit — a big group should keep its recent
			// end, which is the part you're actually in — then flipped, because
			// a group is read in the order it was written.
			const { data: rows } = await supabase
				.from('notes')
				.select(NOTE_SELECT)
				.eq('user_id', user!.id)
				.is('deleted_at', null)
				.eq('archived', false)
				.in('id', ids)
				.order('created_at', { ascending: false })
				.limit(WINDOW);

			peers = (rows ?? []).map(hydrate);

			// The note you opened is always on screen, even when it's older than
			// the window or archived out of the group query.
			if (!peers.some((p) => p.id === note.id)) peers.push(note);
			peers.sort(oldestFirst);
		}
	}

	return {
		note,
		group,
		groups,
		peers,
		/** How many notes carry this tag in total — so a window can say what
		 *  it's a window onto instead of pretending to be the whole group. */
		total
	};
};
