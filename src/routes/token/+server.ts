import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Token endpoint for the OAuth authorization code + PKCE flow. Exchanges a
// one-time code (minted by /authorize) for a plain api_tokens PAT — the same
// kind of token the account page generates by hand, so the MCP endpoint
// doesn't need to know OAuth happened at all.

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type'
};

export const OPTIONS: RequestHandler = async () => new Response(null, { headers: CORS_HEADERS });

export const POST: RequestHandler = async ({ request, locals: { supabase } }) => {
	const contentType = request.headers.get('content-type') ?? '';
	let params: URLSearchParams;
	if (contentType.includes('application/json')) {
		const body = await request.json().catch(() => ({}));
		params = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v ?? '')]));
	} else {
		params = new URLSearchParams(await request.text());
	}

	if (params.get('grant_type') !== 'authorization_code') {
		return json({ error: 'unsupported_grant_type' }, { status: 400, headers: CORS_HEADERS });
	}

	const code = params.get('code') ?? '';
	const clientId = params.get('client_id') ?? '';
	const redirectUri = params.get('redirect_uri') ?? '';
	const codeVerifier = params.get('code_verifier') ?? '';

	if (!code || !clientId || !redirectUri || !codeVerifier) {
		return json({ error: 'invalid_request' }, { status: 400, headers: CORS_HEADERS });
	}

	const { data: accessToken, error } = await supabase.rpc('oauth_exchange_code', {
		p_code: code,
		p_client_id: clientId,
		p_redirect_uri: redirectUri,
		p_code_verifier: codeVerifier
	});

	if (error || !accessToken) {
		return json({ error: 'invalid_grant' }, { status: 400, headers: CORS_HEADERS });
	}

	return json(
		{ access_token: accessToken, token_type: 'bearer' },
		{ headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } }
	);
};
