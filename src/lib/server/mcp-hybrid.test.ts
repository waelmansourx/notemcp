import { describe, expect, test } from 'bun:test';
import { fuseNoteRanks, hybridCandidateLimit } from './mcp-hybrid';

describe('fuseNoteRanks', () => {
	test('agreement outranks a result returned by only one retriever', () => {
		const keyword = [{ id: 'keyword-only' }, { id: 'both' }];
		const semantic = [{ id: 'semantic-only' }, { id: 'both' }];
		expect(fuseNoteRanks(keyword, semantic, 0, 10).map((note) => note.id)).toEqual([
			'both',
			'keyword-only',
			'semantic-only'
		]);
	});

	test('applies paging after fusion and ignores malformed rows', () => {
		const fused = fuseNoteRanks([{ id: 'a' }, {}], [{ id: 'b' }, { id: 'a' }], 1, 1);
		expect(fused).toEqual([{ id: 'b' }]);
	});
});

describe('hybridCandidateLimit', () => {
	test('fetches a useful pool without exceeding the RPC cap', () => {
		expect(hybridCandidateLimit(0, 5)).toBe(30);
		expect(hybridCandidateLimit(20, 10)).toBe(90);
		expect(hybridCandidateLimit(90, 20)).toBe(100);
	});
});
