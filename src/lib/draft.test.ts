import { test, expect, beforeEach } from 'bun:test';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
	get length() {
		return store.size;
	},
	key: (i: number) => [...store.keys()][i] ?? null,
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k)
};

const { saveDraft, readDraft, clearDraft, isNewerThan, pruneDrafts } =
	await import('./draft.svelte');

beforeEach(() => store.clear());

test('a draft round-trips', () => {
	saveDraft('n1', {
		title: 'T',
		content: 'body',
		tags: ['a', 'b'],
		sourceUrl: 'https://example.com/',
		sourceTitle: 'Example',
		sourceDescription: null,
		sourceImage: null,
		parentId: 'root'
	});
	const d = readDraft('n1')!;
	expect(d.title).toBe('T');
	expect(d.content).toBe('body');
	expect(d.tags).toEqual(['a', 'b']);
	expect(d.sourceUrl).toBe('https://example.com/');
	expect(d.sourceTitle).toBe('Example');
	expect(d.parentId).toBe('root');
	expect(Number.isNaN(new Date(d.at).getTime())).toBe(false);
});

test('clearing removes it', () => {
	saveDraft('n1', { title: '', content: 'x', tags: [] });
	clearDraft('n1');
	expect(readDraft('n1')).toBeNull();
});

test('garbage is treated as no draft, not a crash', () => {
	store.set('notemcp:draft:n1', 'not json');
	expect(readDraft('n1')).toBeNull();
});

test('a draft older than the server copy is not newer', () => {
	const draft = { title: '', content: '', tags: [], at: '2026-08-18T10:00:00Z' };
	expect(isNewerThan(draft, '2026-08-18T11:00:00Z')).toBe(false);
	expect(isNewerThan(draft, '2026-08-18T09:00:00Z')).toBe(true);
	expect(isNewerThan(draft, null)).toBe(true);
});

test('prune drops stale and malformed drafts, keeps fresh ones', () => {
	const old = new Date(Date.now() - 30 * 864e5).toISOString();
	store.set('notemcp:draft:stale', JSON.stringify({ title: '', content: '', tags: [], at: old }));
	store.set('notemcp:draft:broken', '{{{');
	saveDraft('fresh', { title: '', content: 'keep me', tags: [] });
	store.set('notemcp:outbox', '[]'); // unrelated key must survive

	pruneDrafts();

	expect(readDraft('stale')).toBeNull();
	expect(readDraft('broken')).toBeNull();
	expect(readDraft('fresh')?.content).toBe('keep me');
	expect(store.get('notemcp:outbox')).toBe('[]');
});
