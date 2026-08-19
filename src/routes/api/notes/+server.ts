import { json, error } from '@sveltejs/kit';
import { createNote } from '$lib/server/notes';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals: { supabase, user } }) => {
	if (!user) throw error(401, 'Not authenticated');

	const body = await request.json();

	const note = await createNote(supabase, user.id, {
		title: body.title,
		content_markdown: body.content_markdown,
		source_url: body.source_url,
		source_type: body.source_type,
		source_title: body.source_title,
		source_description: body.source_description,
		source_image: body.source_image,
		parent_id: typeof body.parent_id === 'string' ? body.parent_id : null,
		pinned: body.pinned,
		tagNames: body.tagNames,
		client_id: typeof body.client_id === 'string' ? body.client_id : null
	});

	return json(note, { status: 201 });
};
