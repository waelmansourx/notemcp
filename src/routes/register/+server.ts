import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Dynamic Client Registration (RFC 7591) for the OAuth authorization code
// flow — remote MCP clients (e.g. claude.ai) call this once to get a
// client_id before sending the user to /authorize. Public client only (PKCE
// covers the security instead of a client secret), so nothing here is
// sensitive enough to require auth.

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type'
};

export const OPTIONS: RequestHandler = async () => new Response(null, { headers: CORS_HEADERS });

export const POST: RequestHandler = async ({ request, locals: { supabase } }) => {
	let body: { client_name?: unknown; redirect_uris?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid_client_metadata' }, { status: 400, headers: CORS_HEADERS });
	}

	const redirectUris = Array.isArray(body.redirect_uris)
		? body.redirect_uris.filter((u): u is string => typeof u === 'string' && u.length > 0)
		: [];
	if (redirectUris.length === 0) {
		return json(
			{ error: 'invalid_redirect_uri', error_description: 'redirect_uris is required' },
			{ status: 400, headers: CORS_HEADERS }
		);
	}

	const clientName = typeof body.client_name === 'string' ? body.client_name : 'MCP client';

	const { data: clientId, error } = await supabase.rpc('oauth_register_client', {
		p_client_name: clientName,
		p_redirect_uris: redirectUris
	});

	if (error || !clientId) {
		return json({ error: 'server_error' }, { status: 500, headers: CORS_HEADERS });
	}

	return json(
		{
			client_id: clientId,
			client_name: clientName,
			redirect_uris: redirectUris,
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code'],
			response_types: ['code']
		},
		{ status: 201, headers: CORS_HEADERS }
	);
};
