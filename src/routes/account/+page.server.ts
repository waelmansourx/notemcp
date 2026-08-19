import { fail } from '@sveltejs/kit';
import { generateToken, hashToken } from '$lib/server/tokens';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, user }, url }) => {
	const { data: tokens } = await supabase
		.from('api_tokens')
		.select('id, name, created_at, last_used_at')
		.eq('user_id', user!.id)
		.order('created_at', { ascending: false });

	return {
		email: user!.email,
		tokens: tokens ?? [],
		mcpUrl: new URL('/mcp', url.origin).toString()
	};
};

export const actions: Actions = {
	setPassword: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const password = String(formData.get('password') ?? '');

		if (password.length < 6) {
			return fail(400, { error: 'Password must be at least 6 characters.' });
		}

		const { error } = await supabase.auth.updateUser({ password });

		if (error) {
			return fail(400, { error: error.message });
		}

		return { saved: true };
	},

	generateToken: async ({ request, locals: { supabase, user } }) => {
		const formData = await request.formData();
		const name = String(formData.get('name') ?? '').trim() || 'MCP token';

		const token = generateToken();
		const token_hash = await hashToken(token);

		const { error } = await supabase
			.from('api_tokens')
			.insert({ user_id: user!.id, name, token_hash });

		if (error) {
			return fail(400, { tokenError: error.message });
		}

		return { created: true, token, name };
	},

	revokeToken: async ({ request, locals: { supabase, user } }) => {
		const formData = await request.formData();
		const id = String(formData.get('id') ?? '');

		await supabase.from('api_tokens').delete().eq('id', id).eq('user_id', user!.id);

		return { revoked: true };
	}
};
