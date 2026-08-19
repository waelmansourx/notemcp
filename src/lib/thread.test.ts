import { describe, expect, it } from 'bun:test';
import { attachChildren, lastActivity, threadCount, threadLabel, threadNotes } from './thread';
import type { Note } from './types';

function note(id: string, over: Partial<Note> = {}): Note {
	return {
		id,
		user_id: 'u',
		title: '',
		content_markdown: id,
		source_url: null,
		source_type: null,
		source_title: null,
		source_description: null,
		source_image: null,
		parent_id: null,
		folder_id: null,
		pinned: false,
		archived: false,
		created_at: '2026-08-18T10:00:00.000Z',
		updated_at: '2026-08-18T10:00:00.000Z',
		deleted_at: null,
		tags: [],
		...over
	};
}

describe('attachChildren', () => {
	it('folds continuations into the note they continue', () => {
		const roots = attachChildren([
			note('head'),
			note('second', { parent_id: 'head', created_at: '2026-08-18T12:00:00.000Z' }),
			note('first', { parent_id: 'head', created_at: '2026-08-18T11:00:00.000Z' })
		]);

		expect(roots.map((r) => r.id)).toEqual(['head']);
		// Oldest first: a thread is read in the order it was written.
		expect(roots[0].children?.map((c) => c.id)).toEqual(['first', 'second']);
	});

	it('leaves the order of roots alone', () => {
		const roots = attachChildren([note('a'), note('b'), note('c')]);
		expect(roots.map((r) => r.id)).toEqual(['a', 'b', 'c']);
		expect(roots.every((r) => r.children === undefined)).toBe(true);
	});

	it('promotes a continuation whose thread is outside the window', () => {
		// The parent scrolled past the limit — the thought still has to be on
		// screen somewhere rather than silently dropped.
		const roots = attachChildren([note('orphan', { parent_id: 'gone' })]);
		expect(roots.map((r) => r.id)).toEqual(['orphan']);
	});

	it('does not mutate the notes it was given', () => {
		const head = note('head');
		attachChildren([head, note('kid', { parent_id: 'head' })]);
		expect(head.children).toBeUndefined();
	});
});

describe('thread helpers', () => {
	it('counts only what was added after the first thought', () => {
		expect(threadCount(note('a'))).toBe(0);
		expect(threadCount({ ...note('a'), children: [note('b'), note('c')] })).toBe(2);
	});

	it('reads a thread head-first', () => {
		const head = { ...note('a'), children: [note('b')] };
		expect(threadNotes(head).map((n) => n.id)).toEqual(['a', 'b']);
	});

	it('takes last activity from the newest thought', () => {
		const head = {
			...note('a', { updated_at: '2026-08-18T10:00:00.000Z' }),
			children: [note('b', { created_at: '2026-08-18T15:00:00.000Z' })]
		};
		expect(lastActivity(head)).toBe('2026-08-18T15:00:00.000Z');
		expect(lastActivity(note('a'))).toBe('2026-08-18T10:00:00.000Z');
	});
});

describe('threadLabel', () => {
	it('prefers a shared link title over the note body', () => {
		expect(
			threadLabel(note('x', { source_title: 'Técnica & Capricho', content_markdown: 'body' }))
		).toBe('Técnica & Capricho');
	});

	it('strips embedded images and markdown noise', () => {
		const n = note('x', { content_markdown: '![](data:image/png;base64,AAAA)\n\n## the eval set' });
		expect(threadLabel(n)).toBe('the eval set');
	});

	it('truncates rather than wrapping a whole paragraph into a chip', () => {
		const n = note('x', { content_markdown: 'a'.repeat(80) });
		expect(threadLabel(n, 20)).toHaveLength(20);
		expect(threadLabel(n, 20).endsWith('…')).toBe(true);
	});

	it('never returns an empty handle', () => {
		expect(threadLabel(note('x', { content_markdown: '' }))).toBe('this thought');
	});
});
