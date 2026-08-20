import { json } from '@sveltejs/kit';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { env } from '$env/dynamic/private';
import {
	pickDefined as pick,
	searchNotesRpcArgs,
	semanticSearchNotesRpcArgs
} from '$lib/server/mcp-arguments';
import { clampAssetSize, loadNoteAsset, type NoteAssetDescriptor } from '$lib/server/mcp-assets';
import { semanticEmbedding } from '$lib/server/mcp-embeddings';
import { fuseNoteRanks, hybridCandidateLimit } from '$lib/server/mcp-hybrid';
import { imageToolResult, presentMcpPayload, toolResult } from '$lib/server/mcp-presentation';
import type { RequestHandler } from './$types';

// Token-gated Streamable HTTP MCP endpoint. Auth is a personal access token
// (Authorization: Bearer <token>) checked inside the mcp_* Postgres functions —
// this route never needs a Supabase session/cookie, it just forwards the token.
//
// Two rules shape the tool set below, and both exist because an agent's
// context window is the scarce resource:
//
//   * default lists never carry note bodies or complete imported captions. One
//     captured photo is a base64 data URL running to megabytes; a single one
//     of those in a list reply would blow out the window. Lists return compact
//     `user_text` + `source` projections, get_note returns the rich note, and
//     an embedded photo is redacted to `![photo]` even there.
//   * editing is a patch, not a rewrite. `replace_in_note` changes one span
//     instead of resending the whole note, and every write takes an optional
//     `if_updated_at` so a note edited on the phone mid-compose is a rejected
//     write rather than a silent overwrite.

// Revoking anon's EXECUTE on the mcp_* functions (see the
// lock_mcp_rpc_to_service_role migration) makes this route the only way in —
// but only once a service-role key is actually configured. Until then we fall
// back to the anon key, which is exactly what the RPCs were reachable with
// before, so a missing env var degrades rather than 500s.
const SERVICE_ROLE_KEY = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? '';

let serviceClient: SupabaseClient | null = null;

function clientFor(fallback: App.Locals['supabase']): App.Locals['supabase'] {
	if (!SERVICE_ROLE_KEY) return fallback;
	serviceClient ??= createClient(PUBLIC_SUPABASE_URL, SERVICE_ROLE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	return serviceClient;
}

const NOTE_SHAPE =
	'Compact notes come back as { id, label, user_text, tags, source, root_id, parent_id, is_thread_head, thread_count, updated_at, … }. ' +
	'`user_text` is only text deliberately written by the user; imported page or social-post copy is source metadata. ' +
	'`label` names the note even when it has no title — use it when showing a note to a human. ' +
	'`updated_at` is what you pass back as `if_updated_at` when you write.';

const NOTE_OUTPUT_SCHEMA = {
	type: 'object',
	properties: {
		id: { type: ['string', 'null'], description: 'Note UUID.' },
		label: { type: ['string', 'null'], description: 'Human-readable note identity.' },
		user_text: {
			type: ['string', 'null'],
			description: 'Only text deliberately authored by the user.'
		},
		tags: { type: 'array', items: { type: 'string' } },
		source: {
			anyOf: [
				{ type: 'null' },
				{
					type: 'object',
					properties: {
						type: { type: ['string', 'null'] },
						domain: { type: ['string', 'null'] },
						title: { type: ['string', 'null'] },
						url: { type: ['string', 'null'] },
						image_available: { type: 'boolean' },
						description: { type: ['string', 'null'] }
					},
					required: ['type', 'domain', 'title', 'url', 'image_available']
				}
			]
		},
		root_id: { type: ['string', 'null'], description: 'Thread root UUID.' },
		parent_id: { type: ['string', 'null'], description: 'Parent note UUID for a continuation.' },
		is_thread_head: { type: 'boolean' },
		thread_count: { type: 'number' },
		updated_at: { type: ['string', 'null'], format: 'date-time' }
	},
	required: [
		'id',
		'label',
		'user_text',
		'tags',
		'source',
		'root_id',
		'parent_id',
		'is_thread_head',
		'thread_count',
		'updated_at'
	],
	additionalProperties: true
} as const;

const NOTES_OUTPUT_SCHEMA = {
	type: 'object',
	properties: {
		notes: { type: 'array', items: NOTE_OUTPUT_SCHEMA },
		error: { type: 'string' }
	},
	anyOf: [{ required: ['notes'] }, { required: ['error'] }],
	additionalProperties: false
} as const;

const TAGS_OUTPUT_SCHEMA = {
	type: 'object',
	properties: {
		tags: {
			type: 'array',
			items: {
				type: 'object',
				properties: { name: { type: 'string' }, count: { type: 'number' } },
				required: ['name', 'count'],
				additionalProperties: false
			}
		},
		error: { type: 'string' }
	},
	anyOf: [{ required: ['tags'] }, { required: ['error'] }],
	additionalProperties: false
} as const;

const TOOLS = [
	{
		name: 'search_notes',
		description:
			"Search the user's notes. Keyword mode (the default) requires every word in `query` to appear somewhere in the note " +
			'(title, body, link preview or tag names), in any order — so "note takes time" finds a note ' +
			'containing all three words, not only that exact phrase. Semantic mode searches by meaning; hybrid ' +
			'fuses both rankings and is best for vague recollections. Source, date, photo and thread filters ' +
			'compose with the text query and tags. Filter by tag with `tags`, which is ' +
			'the right tool for a request like "my #bug notes". Bodies are omitted unless you pass ' +
			`full=true; complete imported source metadata is omitted with them. ${NOTE_SHAPE}`,
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Words to match. Omit to use filters alone.' },
				mode: {
					type: 'string',
					enum: ['keyword', 'semantic', 'hybrid'],
					description:
						'Default keyword preserves deterministic matching. Use semantic or hybrid when exact words are uncertain.'
				},
				tags: {
					type: 'array',
					items: { type: 'string' },
					description:
						'Only notes carrying ALL of these tags. Case-insensitive, no leading #. ' +
						'A tag also covers everything under it: "notemcp" matches a note tagged ' +
						'"notemcp/bug/share", so filter by the broadest level that answers the question ' +
						'and narrow only if you get too much back. Matching is from the start of the ' +
						'path: "main" does not match "features/main".'
				},
				source_type: {
					type: 'string',
					description: 'Exact capture/source type, such as "share" or "agent".'
				},
				source_domain: {
					type: 'string',
					description:
						'Exact source hostname, case-insensitive and ignoring a leading www., such as "instagram.com".'
				},
				has_source: {
					type: 'boolean',
					description: 'Whether imported URL/title/description/image source metadata exists.'
				},
				has_photos: {
					type: 'boolean',
					description: 'Whether the note body contains an embedded or uploaded image.'
				},
				created_after: {
					type: 'string',
					format: 'date-time',
					description: 'Created at or after this timestamp (inclusive).'
				},
				created_before: {
					type: 'string',
					format: 'date-time',
					description: 'Created before this timestamp (exclusive).'
				},
				updated_after: {
					type: 'string',
					format: 'date-time',
					description: 'Updated at or after this timestamp (inclusive).'
				},
				updated_before: {
					type: 'string',
					format: 'date-time',
					description: 'Updated before this timestamp (exclusive).'
				},
				root_id: {
					type: 'string',
					format: 'uuid',
					description: 'Return the thread head and continuations belonging to this root note.'
				},
				limit: { type: 'number', description: 'Max results (default 20, max 100)' },
				offset: { type: 'number', description: 'Skip this many results, for paging' },
				archived: {
					type: 'string',
					enum: ['exclude', 'include', 'only'],
					description: 'Default exclude.'
				},
				full: {
					type: 'boolean',
					description: 'Include each note’s body. Default false — leave it off for wide searches.'
				}
			}
		},
		outputSchema: NOTES_OUTPUT_SCHEMA
	},
	{
		name: 'get_note_asset',
		description:
			'Fetch one image associated with an existing note as actual MCP image content. This never accepts a URL: ' +
			'use asset="source" for the stored link/social preview, or asset="body" plus a zero-based index for ' +
			'an uploaded image in the note body. Images are resized and compressed on demand; search/list responses never include thumbnails.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'Note id (uuid)' },
				asset: {
					type: 'string',
					enum: ['source', 'body'],
					description: 'Default source.'
				},
				index: {
					type: 'number',
					description: 'Zero-based image index. Default 0.'
				},
				max_size: {
					type: 'number',
					description: 'Maximum width/height in pixels, clamped to 512–768. Default 640.'
				}
			},
			required: ['id']
		}
	},
	{
		name: 'list_recent_notes',
		description:
			"List the user's notes, most recently touched first — the same order as the app's stream, " +
			'so "recent" means the same thing in both. Returns thread heads only unless you ask for ' +
			`continuations. Bodies and complete imported source metadata are omitted unless you pass full=true. ${NOTE_SHAPE}`,
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'number', description: 'Max results (default 20, max 100)' },
				offset: { type: 'number', description: 'Skip this many results, for paging' },
				order: {
					type: 'string',
					enum: ['updated', 'created'],
					description: 'Default updated (last activity), matching the app.'
				},
				archived: {
					type: 'string',
					enum: ['exclude', 'include', 'only'],
					description: 'Default exclude.'
				},
				include_continuations: {
					type: 'boolean',
					description:
						'Include notes that continue a thread as separate rows. Default false — read a thread with get_note instead.'
				},
				full: { type: 'boolean', description: 'Include note bodies. Default false.' }
			}
		},
		outputSchema: NOTES_OUTPUT_SCHEMA
	},
	{
		name: 'get_note',
		description:
			'Fetch one note in full, plus `thread`: the thoughts appended to it, oldest first. ' +
			'`label` identifies it, `user_text` is user-authored, and `source` is the single canonical home for ' +
			'imported context. `source.image_available` tells you whether get_note_asset can fetch its preview. ' +
			'Body images appear as `![photo]`; retrieve bytes with get_note_asset. A note with has_photos=true ' +
			'cannot be rewritten whole, so patch it with replace_in_note or append_to_note.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'Note id (uuid)' },
				full: { type: 'boolean', description: 'Include bodies. Default true.' }
			},
			required: ['id']
		}
	},
	{
		name: 'list_tags',
		description:
			'Every tag the user has, with how many live notes carry it. Read this before guessing a ' +
			'tag name. Tags are paths: a "project/type" name like "notemcp/bug" is listed alongside ' +
			'the broader "notemcp", and searching the broader one finds everything under it.',
		inputSchema: { type: 'object', properties: {} },
		outputSchema: TAGS_OUTPUT_SCHEMA
	},
	{
		name: 'create_note',
		description:
			'Create a note. Pass `parent_id` to continue an existing thread instead of starting a new ' +
			'thought — threads are flat, so continuing a continuation continues the thread it belongs to. ' +
			'Pass a `client_id` uuid you generate to make the call idempotent: retrying with the same ' +
			'client_id returns the note the first attempt created rather than a duplicate.',
		inputSchema: {
			type: 'object',
			properties: {
				title: { type: 'string' },
				content_markdown: { type: 'string', description: 'Markdown body of the note' },
				source_url: { type: 'string' },
				tags: { type: 'array', items: { type: 'string' } },
				parent_id: { type: 'string', description: 'Note this one continues (uuid)' },
				client_id: {
					type: 'string',
					description: 'A uuid you generate, so a retry cannot create a second note'
				}
			},
			required: ['content_markdown']
		}
	},
	{
		name: 'replace_in_note',
		description:
			'Change one span of a note without resending the rest of it. `find` is literal text, not a ' +
			'regex or a pattern. Ticking a checkbox is find "- [ ] Buy milk", replace "- [x] Buy milk". ' +
			'If the text appears more than once the call is rejected rather than guessing — add ' +
			'surrounding text or pass all=true. Prefer this over update_note for any edit smaller than ' +
			'the whole note.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				find: { type: 'string', description: 'Exact text to find (literal, not a pattern)' },
				replace: { type: 'string', description: 'What to put in its place. Omit to delete it.' },
				all: { type: 'boolean', description: 'Replace every occurrence. Default false.' },
				if_updated_at: {
					type: 'string',
					description:
						"The note's updated_at from when you last read it. If it has changed since, the write is rejected instead of clobbering the newer version."
				}
			},
			required: ['id', 'find']
		}
	},
	{
		name: 'append_to_note',
		description: "Append markdown to the end of an existing note's body.",
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				content_markdown: { type: 'string' },
				if_updated_at: {
					type: 'string',
					description: 'Reject the write if the note changed since you read it.'
				}
			},
			required: ['id', 'content_markdown']
		}
	},
	{
		name: 'update_note',
		description:
			'Replace whole fields on a note. Omitted fields are left unchanged; to empty a field, name ' +
			'it in `clear` (passing "" is not enough). For anything short of a full rewrite use ' +
			'replace_in_note — it cannot mangle the text it is not touching. Rewriting the body of a ' +
			'note that embeds a photo is refused, because MCP only ever showed you `![photo]`.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				title: { type: 'string' },
				content_markdown: { type: 'string' },
				source_url: { type: 'string' },
				pinned: { type: 'boolean' },
				archived: { type: 'boolean' },
				clear: {
					type: 'array',
					items: { type: 'string', enum: ['title', 'content_markdown', 'source_url'] },
					description: 'Fields to empty out.'
				},
				if_updated_at: {
					type: 'string',
					description: 'Reject the write if the note changed since you read it.'
				}
			},
			required: ['id']
		}
	},
	{
		name: 'tag_note',
		description: 'Add tags to a note. Tags already on the note are kept.',
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
			required: ['id', 'tags']
		}
	},
	{
		name: 'untag_note',
		description: 'Remove tags from a note. Tags not on the note are ignored.',
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
			required: ['id', 'tags']
		}
	},
	{
		name: 'delete_note',
		description:
			'Move a note to the trash (a soft delete — the app can still recover it). A note with ' +
			'continuations takes its whole thread with it, so that has to be asked for with cascade=true.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				cascade: { type: 'boolean', description: 'Also delete the thoughts continuing this note.' },
				if_updated_at: {
					type: 'string',
					description: 'Reject the delete if the note changed since you read it.'
				}
			},
			required: ['id']
		}
	}
] as const;

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers':
		'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version'
};

function rpcResult(id: unknown, result: unknown) {
	return json({ jsonrpc: '2.0', id, result }, { headers: CORS_HEADERS });
}

function rpcError(id: unknown, code: number, message: string) {
	return json({ jsonrpc: '2.0', id, error: { code, message } }, { headers: CORS_HEADERS });
}

function clampLimit(n: unknown) {
	const parsed = Number(n);
	return Math.min(Math.max(Number.isFinite(parsed) && parsed > 0 ? parsed : 20, 1), 100);
}

function clampOffset(n: unknown) {
	const parsed = Number(n);
	return Math.max(Number.isFinite(parsed) ? Math.floor(parsed) : 0, 0);
}

async function callTool(
	supabase: App.Locals['supabase'],
	token: string | null,
	name: string,
	args: Record<string, unknown>
) {
	if (!token) {
		return toolResult(
			name,
			{ error: 'Missing bearer token. Pass Authorization: Bearer <token>.' },
			true
		);
	}

	let fn: string;
	let rpcArgs: Record<string, unknown>;

	switch (name) {
		case 'search_notes': {
			const mode =
				args.mode === 'semantic' || args.mode === 'hybrid' ? args.mode : ('keyword' as const);
			const limit = clampLimit(args.limit);
			if (mode === 'keyword') {
				fn = 'mcp_search_notes';
				rpcArgs = searchNotesRpcArgs(token, args, limit);
				break;
			}

			const query = typeof args.query === 'string' ? args.query.trim() : '';
			if (!query) {
				return toolResult(name, { error: `${mode} search requires a non-empty query` }, true);
			}
			const { embedding } = await semanticEmbedding(token, query);

			if (mode === 'semantic') {
				fn = 'mcp_search_notes_semantic';
				rpcArgs = semanticSearchNotesRpcArgs(token, args, embedding, limit);
				break;
			}

			const offset = clampOffset(args.offset);
			const candidateLimit = hybridCandidateLimit(offset, limit);
			const [keywordResult, semanticResult] = await Promise.all([
				supabase.rpc('mcp_search_notes', searchNotesRpcArgs(token, args, candidateLimit, 0)),
				supabase.rpc(
					'mcp_search_notes_semantic',
					semanticSearchNotesRpcArgs(token, args, embedding, candidateLimit, 0)
				)
			]);
			if (keywordResult.error) {
				return toolResult(name, { error: keywordResult.error.message }, true);
			}
			if (semanticResult.error) {
				return toolResult(name, { error: semanticResult.error.message }, true);
			}

			const keyword = Array.isArray(keywordResult.data) ? keywordResult.data : [];
			const semantic = Array.isArray(semanticResult.data) ? semanticResult.data : [];
			const fused = fuseNoteRanks(keyword, semantic, offset, limit);
			return toolResult(name, presentMcpPayload(name, args, fused));
		}
		case 'list_recent_notes':
			fn = 'mcp_list_recent_notes';
			rpcArgs = pick(
				args,
				{
					offset: 'p_offset',
					order: 'p_order',
					archived: 'p_archived',
					include_continuations: 'p_include_continuations',
					full: 'p_full'
				},
				{ p_token: token, p_limit: clampLimit(args.limit) }
			);
			break;
		case 'get_note':
			fn = 'mcp_get_note';
			rpcArgs = pick(args, { full: 'p_full' }, { p_token: token, p_note_id: args.id });
			break;
		case 'get_note_asset': {
			const asset = args.asset === 'body' ? 'body' : 'source';
			const index = Math.max(Math.floor(Number(args.index) || 0), 0);
			const descriptorResult = await supabase.rpc('mcp_get_note_asset_descriptor', {
				p_token: token,
				p_note_id: args.id,
				p_asset: asset,
				p_index: index
			});
			if (descriptorResult.error) {
				return toolResult(name, { error: descriptorResult.error.message }, true);
			}

			const descriptor = descriptorResult.data as NoteAssetDescriptor;
			const loaded = await loadNoteAsset(descriptor, clampAssetSize(args.max_size));
			return imageToolResult(
				{
					note_id: descriptor.note_id,
					asset: descriptor.asset,
					index: descriptor.index,
					mime_type: loaded.mimeType,
					width: loaded.width,
					height: loaded.height,
					byte_size: loaded.byteSize,
					cached: loaded.cached
				},
				loaded
			);
		}
		case 'list_tags':
			fn = 'mcp_list_tags';
			rpcArgs = { p_token: token };
			break;
		case 'create_note':
			fn = 'mcp_create_note';
			rpcArgs = pick(
				args,
				{
					title: 'p_title',
					source_url: 'p_source_url',
					tags: 'p_tags',
					parent_id: 'p_parent_id',
					client_id: 'p_client_id'
				},
				{
					p_token: token,
					p_content_markdown: args.content_markdown ?? '',
					p_source_type: 'agent'
				}
			);
			break;
		case 'update_note':
			fn = 'mcp_update_note';
			rpcArgs = pick(
				args,
				{
					title: 'p_title',
					content_markdown: 'p_content_markdown',
					source_url: 'p_source_url',
					pinned: 'p_pinned',
					archived: 'p_archived',
					clear: 'p_clear',
					if_updated_at: 'p_if_updated_at'
				},
				{ p_token: token, p_note_id: args.id }
			);
			break;
		case 'append_to_note':
			fn = 'mcp_append_to_note';
			rpcArgs = pick(
				args,
				{ if_updated_at: 'p_if_updated_at' },
				{ p_token: token, p_note_id: args.id, p_content_markdown: args.content_markdown ?? '' }
			);
			break;
		case 'replace_in_note':
			fn = 'mcp_replace_in_note';
			rpcArgs = pick(
				args,
				{ replace: 'p_replace', all: 'p_all', if_updated_at: 'p_if_updated_at' },
				{ p_token: token, p_note_id: args.id, p_find: args.find ?? '' }
			);
			break;
		case 'tag_note':
			fn = 'mcp_tag_note';
			rpcArgs = { p_token: token, p_note_id: args.id, p_tags: args.tags ?? [] };
			break;
		case 'untag_note':
			fn = 'mcp_untag_note';
			rpcArgs = { p_token: token, p_note_id: args.id, p_tags: args.tags ?? [] };
			break;
		case 'delete_note':
			fn = 'mcp_delete_note';
			rpcArgs = pick(
				args,
				{ cascade: 'p_cascade', if_updated_at: 'p_if_updated_at' },
				{ p_token: token, p_note_id: args.id }
			);
			break;
		default:
			return null;
	}

	const { data, error } = await supabase.rpc(fn, rpcArgs);
	if (error) return toolResult(name, { error: error.message }, true);
	return toolResult(name, presentMcpPayload(name, args, data));
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

	let body: {
		id?: unknown;
		method?: string;
		params?: { name?: string; arguments?: Record<string, unknown> };
	};
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
			serverInfo: { name: 'notemcp', version: '0.4.0' }
		});
	}

	if (method === 'ping') return rpcResult(id, {});

	if (method === 'tools/list') return rpcResult(id, { tools: TOOLS });

	if (method === 'tools/call') {
		const name = params?.name ?? '';
		try {
			const args = params?.arguments ?? {};
			const result = await callTool(clientFor(supabase), token, name, args);
			if (result === null) return rpcError(id, -32602, `Unknown tool: ${name}`);
			return rpcResult(id, result);
		} catch (err) {
			// A network blip talking to Supabase (or anything else unexpected)
			// must not crash the function — an uncaught rejection here becomes
			// a raw 502 to the MCP client instead of a JSON-RPC error it can
			// actually show the user and retry against.
			const message = err instanceof Error ? err.message : 'Unexpected error';
			return rpcResult(id, toolResult(name, { error: message }, true));
		}
	}

	return rpcError(id, -32601, `Method not found: ${method}`);
};
