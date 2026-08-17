import { json, error } from '@sveltejs/kit';
import { setNoteTags } from '$lib/server/notes';
import type { RequestHandler } from './$types';

const NOTE_SELECT = '*, note_tags(tags(id, name))';

function normalize(row: any) {
	const { note_tags, ...rest } = row;
	return { ...rest, tags: (note_tags ?? []).map((nt: any) => nt.tags).filter(Boolean) };
}

export const PATCH: RequestHandler = async ({ request, params, locals: { supabase, user } }) => {
	if (!user) throw error(401, 'Not authenticated');

	const body = await request.json();
	const updates: Record<string, unknown> = {};

	for (const key of ['title', 'content_markdown', 'source_url', 'source_type', 'pinned', 'archived']) {
		if (key in body) updates[key] = body[key];
	}

	if (Object.keys(updates).length > 0) {
		const { error: updateError } = await supabase
			.from('notes')
			.update(updates)
			.eq('id', params.id)
			.eq('user_id', user.id);
		if (updateError) throw error(400, updateError.message);
	}

	if (Array.isArray(body.tagNames)) {
		await setNoteTags(supabase, user.id, params.id!, body.tagNames);
	}

	const { data, error: fetchError } = await supabase
		.from('notes')
		.select(NOTE_SELECT)
		.eq('id', params.id)
		.single();

	if (fetchError || !data) throw error(404, 'Note not found');

	return json(normalize(data));
};

export const DELETE: RequestHandler = async ({ params, url, locals: { supabase, user } }) => {
	if (!user) throw error(401, 'Not authenticated');

	if (url.searchParams.get('hard') === '1') {
		const { error: deleteError } = await supabase
			.from('notes')
			.delete()
			.eq('id', params.id)
			.eq('user_id', user.id);
		if (deleteError) throw error(400, deleteError.message);
	} else {
		const { error: deleteError } = await supabase
			.from('notes')
			.update({ deleted_at: new Date().toISOString() })
			.eq('id', params.id)
			.eq('user_id', user.id);
		if (deleteError) throw error(400, deleteError.message);
	}

	return json({ ok: true });
};
