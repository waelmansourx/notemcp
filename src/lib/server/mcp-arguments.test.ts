import { describe, expect, it } from 'bun:test';
import { pickDefined, searchNotesRpcArgs, semanticSearchNotesRpcArgs } from './mcp-arguments';

describe('MCP RPC arguments', () => {
	it('maps every deterministic search filter to its named Postgres parameter', () => {
		expect(
			searchNotesRpcArgs(
				'token',
				{
					query: 'design',
					tags: ['inspo'],
					offset: 10,
					archived: 'include',
					full: false,
					source_type: 'share',
					source_domain: 'instagram.com',
					has_source: true,
					has_photos: false,
					created_after: '2026-08-01T00:00:00Z',
					created_before: '2026-09-01T00:00:00Z',
					updated_after: '2026-08-10T00:00:00Z',
					updated_before: '2026-08-20T00:00:00Z',
					root_id: '00000000-0000-0000-0000-000000000001'
				},
				20
			)
		).toEqual({
			p_token: 'token',
			p_query: 'design',
			p_limit: 20,
			p_tags: ['inspo'],
			p_offset: 10,
			p_archived: 'include',
			p_full: false,
			p_source_type: 'share',
			p_source_domain: 'instagram.com',
			p_has_source: true,
			p_has_photos: false,
			p_created_after: '2026-08-01T00:00:00Z',
			p_created_before: '2026-09-01T00:00:00Z',
			p_updated_after: '2026-08-10T00:00:00Z',
			p_updated_before: '2026-08-20T00:00:00Z',
			p_root_id: '00000000-0000-0000-0000-000000000001'
		});
	});

	it('does not turn omitted or null arguments into explicit RPC nulls', () => {
		expect(
			pickDefined(
				{ present: false, omitted: undefined, empty: null },
				{
					present: 'p_present',
					omitted: 'p_omitted',
					empty: 'p_empty'
				},
				{}
			)
		).toEqual({ p_present: false });
	});

	it('maps semantic filters without forwarding mode or query as SQL arguments', () => {
		const embedding = [0.1, 0.2];
		expect(
			semanticSearchNotesRpcArgs(
				'token',
				{ query: 'meaning', mode: 'semantic', tags: ['ideas'], offset: 12, full: true },
				embedding,
				30,
				0
			)
		).toEqual({
			p_token: 'token',
			p_query_embedding: embedding,
			p_limit: 30,
			p_tags: ['ideas'],
			p_offset: 0,
			p_full: true
		});
	});
});
