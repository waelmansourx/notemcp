import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, params, locals: { supabase, user } }) => {
	if (!user) throw error(401, 'Not authenticated');

	const body = await request.json();
	const name =
		typeof body.name === 'string' ? body.name.trim().toLowerCase().replace(/^#/, '') : '';
	if (!name) throw error(400, 'Tag name is required');

	const { data: clash } = await supabase
		.from('tags')
		.select('id')
		.eq('user_id', user.id)
		.eq('name', name)
		.neq('id', params.id)
		.maybeSingle();

	if (clash) throw error(409, 'A tag with that name already exists');

	const { data, error: updateError } = await supabase
		.from('tags')
		.update({ name })
		.eq('id', params.id)
		.eq('user_id', user.id)
		.select('id, name')
		.single();

	if (updateError || !data) throw error(404, 'Tag not found');

	return json(data);
};
