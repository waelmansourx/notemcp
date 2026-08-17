import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

interface AuthorizeParams {
	client_id: string;
	redirect_uri: string;
	code_challenge: string;
	code_challenge_method: string;
	state: string;
}

function readParams(url: URL): AuthorizeParams | null {
	const client_id = url.searchParams.get('client_id') ?? '';
	const redirect_uri = url.searchParams.get('redirect_uri') ?? '';
	const code_challenge = url.searchParams.get('code_challenge') ?? '';
	const code_challenge_method = url.searchParams.get('code_challenge_method') ?? '';
	const state = url.searchParams.get('state') ?? '';
	if (!client_id || !redirect_uri || !code_challenge) return null;
	return { client_id, redirect_uri, code_challenge, code_challenge_method, state };
}

export const load: PageServerLoad = async ({ url, locals: { supabase } }) => {
	if (url.searchParams.get('response_type') !== 'code') {
		return { error: 'Unsupported response_type — only "code" is supported.' };
	}

	const params = readParams(url);
	if (!params) {
		return { error: 'Missing required OAuth parameters.' };
	}
	if (params.code_challenge_method !== 'S256') {
		return { error: 'Only the S256 PKCE code_challenge_method is supported.' };
	}

	const { data, error } = await supabase
		.rpc('oauth_get_client', { p_client_id: params.client_id })
		.single<{ client_name: string; redirect_uris: string[] }>();

	if (error || !data) {
		return { error: 'Unknown client. It may need to register again.' };
	}
	if (!data.redirect_uris.includes(params.redirect_uri)) {
		return { error: 'This redirect_uri is not registered for this client.' };
	}

	return { params, clientName: data.client_name };
};

export const actions: Actions = {
	approve: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const client_id = String(formData.get('client_id') ?? '');
		const redirect_uri = String(formData.get('redirect_uri') ?? '');
		const code_challenge = String(formData.get('code_challenge') ?? '');
		const code_challenge_method = String(formData.get('code_challenge_method') ?? '');
		const state = String(formData.get('state') ?? '');

		const { data: code, error } = await supabase.rpc('oauth_create_code', {
			p_client_id: client_id,
			p_redirect_uri: redirect_uri,
			p_code_challenge: code_challenge,
			p_code_challenge_method: code_challenge_method
		});

		if (error || !code) {
			return fail(400, { error: 'Could not authorize this client. Try again.' });
		}

		const dest = new URL(redirect_uri);
		dest.searchParams.set('code', code);
		if (state) dest.searchParams.set('state', state);
		throw redirect(303, dest.toString());
	},

	deny: async ({ request }) => {
		const formData = await request.formData();
		const redirect_uri = String(formData.get('redirect_uri') ?? '');
		const state = String(formData.get('state') ?? '');

		const dest = new URL(redirect_uri);
		dest.searchParams.set('error', 'access_denied');
		if (state) dest.searchParams.set('state', state);
		throw redirect(303, dest.toString());
	}
};
