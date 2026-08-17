import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Token-gated Streamable HTTP MCP endpoint. Auth is a personal access token
// (Authorization: Bearer <token>) checked inside the mcp_* Postgres functions —
// this route never needs a Supabase session/cookie, it just forwards the token.

const TOOLS = [
	{
		name: 'search_notes',
		description: "Search the user's notes by keyword across title, content, and tag names.",
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Search text' },
				limit: { type: 'number', description: 'Max results (default 20, max 100)' }
			},
			required: ['query']
		}
	},
	{
		name: 'list_recent_notes',
		description: "List the user's most recently created notes, newest first.",
		inputSchema: {
			type: 'object',
			properties: { limit: { type: 'number', description: 'Max results (default 20, max 100)' } }
		}
	},
	{
		name: 'get_note',
		description: 'Fetch a single note by id.',
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'string', description: 'Note id (uuid)' } },
			required: ['id']
		}
	},
	{
		name: 'create_note',
		description: 'Create a new note in the inbox (or tagged, if tags are given).',
		inputSchema: {
			type: 'object',
			properties: {
				title: { type: 'string' },
				content_markdown: { type: 'string', description: 'Markdown body of the note' },
				source_url: { type: 'string' },
				tags: { type: 'array', items: { type: 'string' } }
			},
			required: ['content_markdown']
		}
	},
	{
		name: 'update_note',
		description: 'Update fields on an existing note. Omitted fields are left unchanged.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				title: { type: 'string' },
				content_markdown: { type: 'string' },
				source_url: { type: 'string' },
				pinned: { type: 'boolean' },
				archived: { type: 'boolean' }
			},
			required: ['id']
		}
	},
	{
		name: 'append_to_note',
		description: "Append markdown content to the end of an existing note's body.",
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'string' }, content_markdown: { type: 'string' } },
			required: ['id', 'content_markdown']
		}
	},
	{
		name: 'tag_note',
		description: 'Add one or more tags to a note. Existing tags on the note are kept.',
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
			required: ['id', 'tags']
		}
	}
] as const;

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version'
};

function rpcResult(id: unknown, result: unknown) {
	return json({ jsonrpc: '2.0', id, result }, { headers: CORS_HEADERS });
}

function rpcError(id: unknown, code: number, message: string) {
	return json({ jsonrpc: '2.0', id, error: { code, message } }, { headers: CORS_HEADERS });
}

function toolResult(payload: unknown, isError = false) {
	return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError };
}

function clampLimit(n: unknown) {
	const parsed = Number(n);
	return Math.min(Math.max(Number.isFinite(parsed) && parsed > 0 ? parsed : 20, 1), 100);
}

async function callTool(
	supabase: App.Locals['supabase'],
	token: string | null,
	name: string,
	args: Record<string, unknown>
) {
	if (!token) {
		return toolResult({ error: 'Missing bearer token. Pass Authorization: Bearer <token>.' }, true);
	}

	let fn: string;
	let rpcArgs: Record<string, unknown>;

	switch (name) {
		case 'search_notes':
			fn = 'mcp_search_notes';
			rpcArgs = { p_token: token, p_query: String(args.query ?? ''), p_limit: clampLimit(args.limit) };
			break;
		case 'list_recent_notes':
			fn = 'mcp_list_recent_notes';
			rpcArgs = { p_token: token, p_limit: clampLimit(args.limit) };
			break;
		case 'get_note':
			fn = 'mcp_get_note';
			rpcArgs = { p_token: token, p_note_id: args.id };
			break;
		case 'create_note':
			fn = 'mcp_create_note';
			rpcArgs = {
				p_token: token,
				p_title: args.title ?? '',
				p_content_markdown: args.content_markdown ?? '',
				p_source_url: args.source_url ?? null,
				p_source_type: 'agent',
				p_tags: args.tags ?? []
			};
			break;
		case 'update_note':
			fn = 'mcp_update_note';
			rpcArgs = {
				p_token: token,
				p_note_id: args.id,
				p_title: args.title ?? null,
				p_content_markdown: args.content_markdown ?? null,
				p_source_url: args.source_url ?? null,
				p_pinned: args.pinned ?? null,
				p_archived: args.archived ?? null
			};
			break;
		case 'append_to_note':
			fn = 'mcp_append_to_note';
			rpcArgs = { p_token: token, p_note_id: args.id, p_content_markdown: args.content_markdown ?? '' };
			break;
		case 'tag_note':
			fn = 'mcp_tag_note';
			rpcArgs = { p_token: token, p_note_id: args.id, p_tags: args.tags ?? [] };
			break;
		default:
			return null;
	}

	const { data, error } = await supabase.rpc(fn, rpcArgs);
	if (error) return toolResult({ error: error.message }, true);
	return toolResult(data);
}

export const OPTIONS: RequestHandler = async () => new Response(null, { headers: CORS_HEADERS });

export const GET: RequestHandler = async () =>
	json(
		{ name: 'notemcp', transport: 'streamable-http', tools: TOOLS.map((t) => t.name) },
		{ headers: CORS_HEADERS }
	);

export const POST: RequestHandler = async ({ request, locals: { supabase } }) => {
	const auth = request.headers.get('authorization') ?? '';
	const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;

	let body: { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
	try {
		body = await request.json();
	} catch {
		return rpcError(null, -32700, 'Parse error');
	}

	const { id, method, params } = body ?? {};

	if (typeof method === 'string' && method.startsWith('notifications/')) {
		return new Response(null, { status: 202, headers: CORS_HEADERS });
	}

	if (method === 'initialize') {
		return rpcResult(id, {
			protocolVersion: '2025-06-18',
			capabilities: { tools: {} },
			serverInfo: { name: 'notemcp', version: '0.1.0' }
		});
	}

	if (method === 'ping') return rpcResult(id, {});

	if (method === 'tools/list') return rpcResult(id, { tools: TOOLS });

	if (method === 'tools/call') {
		try {
			const name = params?.name ?? '';
			const args = params?.arguments ?? {};
			const result = await callTool(supabase, token, name, args);
			if (result === null) return rpcError(id, -32602, `Unknown tool: ${name}`);
			return rpcResult(id, result);
		} catch (err) {
			// A network blip talking to Supabase (or anything else unexpected)
			// must not crash the function — an uncaught rejection here becomes
			// a raw 502 to the MCP client instead of a JSON-RPC error it can
			// actually show the user and retry against.
			const message = err instanceof Error ? err.message : 'Unexpected error';
			return rpcResult(id, toolResult({ error: message }, true));
		}
	}

	return rpcError(id, -32601, `Method not found: ${method}`);
};
