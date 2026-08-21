import { beforeEach, expect, test } from 'bun:test';

const store = new Map<string, string>();
(globalThis as any).sessionStorage = {
	getItem: (key: string) => store.get(key) ?? null,
	setItem: (key: string, value: string) => void store.set(key, value),
	removeItem: (key: string) => void store.delete(key)
};

const { saveEditorHandoff, takeEditorHandoff } = await import('./editor-handoff');

beforeEach(() => store.clear());

test('an editor handoff is consumed exactly once', () => {
	const handoff = {
		content: 'hello',
		tags: ['idea'],
		parentId: 'root',
		sourceUrl: 'https://example.com/',
		sourceTitle: 'Example',
		sourceDescription: null,
		sourceImage: null
	};
	const id = saveEditorHandoff(handoff);
	expect(id).not.toBeNull();
	expect(takeEditorHandoff(id!)).toEqual(handoff);
	expect(takeEditorHandoff(id!)).toBeNull();
});

test('invalid handoffs are ignored and removed', () => {
	store.set('notemcp:editor-handoff:broken', '{nope');
	expect(takeEditorHandoff('broken')).toBeNull();
	expect(store.size).toBe(0);
});
