import { describe, expect, it } from 'bun:test';
import { groupsOf, noteLabel, oldestFirst, primaryGroup, stubOf } from './group';
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

function tagged(id: string, names: string[], over: Partial<Note> = {}): Note {
	return note(id, { tags: names.map((name) => ({ id: `t-${name}`, name })), ...over });
}

describe('groupsOf', () => {
	it('orders tags so "the first one" is stable across loads', () => {
		// The join returns these in whatever order it likes; the server and the
		// client have to pick the same group without coordinating.
		expect(groupsOf(tagged('a', ['work', 'dental', 'idea']))).toEqual(['dental', 'idea', 'work']);
	});

	it('is empty for an untagged note — it belongs to no group', () => {
		expect(groupsOf(note('a'))).toEqual([]);
	});
});

describe('primaryGroup', () => {
	it('honours the group the URL asked for', () => {
		expect(primaryGroup(tagged('a', ['dental', 'work']), 'work')).toBe('work');
	});

	it('ignores a preference the note does not actually carry', () => {
		// Otherwise ?group=anything would show a note among strangers.
		expect(primaryGroup(tagged('a', ['dental']), 'work')).toBe('dental');
	});

	it('falls back to the first tag, and to nothing at all', () => {
		expect(primaryGroup(tagged('a', ['work', 'dental']))).toBe('dental');
		expect(primaryGroup(note('a'))).toBeNull();
	});
});

describe('oldestFirst', () => {
	it('reads a group in the order it was written', () => {
		const notes = [
			note('c', { created_at: '2026-08-18T15:00:00.000Z' }),
			note('a', { created_at: '2026-08-18T09:00:00.000Z' }),
			note('b', { created_at: '2026-08-18T12:00:00.000Z' })
		];
		expect([...notes].sort(oldestFirst).map((n) => n.id)).toEqual(['a', 'b', 'c']);
	});
});

describe('noteLabel', () => {
	it('prefers a shared link title over the note body', () => {
		expect(
			noteLabel(note('x', { source_title: 'Técnica & Capricho', content_markdown: 'body' }))
		).toBe('Técnica & Capricho');
	});

	it('strips embedded images and markdown noise', () => {
		const n = note('x', { content_markdown: '![](data:image/png;base64,AAAA)\n\n## the eval set' });
		expect(noteLabel(n)).toBe('the eval set');
	});

	it('truncates rather than wrapping a whole paragraph into a chip', () => {
		const n = note('x', { content_markdown: 'a'.repeat(80) });
		expect(noteLabel(n, 20)).toHaveLength(20);
		expect(noteLabel(n, 20).endsWith('…')).toBe(true);
	});

	it('never returns an empty handle', () => {
		expect(noteLabel(note('x', { content_markdown: '' }))).toBe('this thought');
	});
});

describe('stubOf', () => {
	it('carries a picture and a host, never a body', () => {
		const n = note('x', {
			source_url: 'https://www.youtube.com/watch?v=1',
			source_image: 'https://img/1.jpg',
			source_title: 'A talk'
		});
		expect(stubOf(n)).toEqual({
			id: 'x',
			label: 'A talk',
			image: 'https://img/1.jpg',
			source: 'youtube.com',
			at: '2026-08-18T10:00:00.000Z'
		});
	});

	it('survives a source_url that is not a URL', () => {
		expect(stubOf(note('x', { source_url: 'not a url' })).source).toBeNull();
	});
});
