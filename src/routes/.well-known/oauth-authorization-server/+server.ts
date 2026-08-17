import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// RFC 8414 discovery document. This is how MCP clients (claude.ai included)
// find /authorize, /token, and /register instead of guessing paths.
export const GET: RequestHandler = ({ url }) => {
	const issuer = url.origin;
	return json(
		{
			issuer,
			authorization_endpoint: `${issuer}/authorize`,
			token_endpoint: `${issuer}/token`,
			registration_endpoint: `${issuer}/register`,
			response_types_supported: ['code'],
			grant_types_supported: ['authorization_code'],
			code_challenge_methods_supported: ['S256'],
			token_endpoint_auth_methods_supported: ['none']
		},
		{ headers: { 'Access-Control-Allow-Origin': '*' } }
	);
};
