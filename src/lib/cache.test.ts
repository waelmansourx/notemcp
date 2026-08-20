import { test, expect, beforeEach } from 'bun:test';
import type { Note } from './types';

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

const {
	saveStream,
	loadStream,
	saveAllTags,
	saveRecentTags,
	loadAllTags,
	loadRecentTags,
	clearCache
} = await import('./cache');

beforeEach(() => store.clear());

function note(id: string, body = 'hello', children?: Note[]): Note {
	return {
		id,
		user_id: 'u',
		title: '',
		content_markdown: body,
		source_url: null,
		source_type: null,
		source_title: null,
		source_description: null,
		source_image: null,
		parent_id: null,
		folder_id: null,
		pinned: false,
		archived: false,
		created_at: '2026-08-20T10:00:00Z',
		updated_at: '2026-08-20T10:00:00Z',
		deleted_at: null,
		tags: [],
		...(children ? { children } : {})
	} as Note;
}

test('a stream round-trips', () => {
	saveStream([note('a'), note('b')]);
	expect(loadStream()?.map((n) => n.id)).toEqual(['a', 'b']);
});

test('nothing cached reads as null, not an empty stream', () => {
	// The difference matters: null means "no copy on this device" (show the
	// loading shape), [] would mean "you have written nothing".
	expect(loadStream()).toBeNull();
});

test('garbage is treated as no cache, not a crash', () => {
	store.set('notemcp:stream', 'not json');
	expect(loadStream()).toBeNull();
});

test('only the first 120 notes are kept', () => {
	saveStream(Array.from({ length: 200 }, (_, i) => note(`n${i}`)));
	const cached = loadStream()!;
	expect(cached).toHaveLength(120);
	expect(cached[0].id).toBe('n0');
});

test('an oversized body is stored trimmed rather than blowing the quota', () => {
	// A captured photo is a base64 data URL running to megabytes; one of those
	// would take the whole cache down with it.
	saveStream([note('big', 'x'.repeat(50_000))]);
	expect(loadStream()![0].content_markdown).toHaveLength(4_000);
});

test('a long continuation is trimmed too', () => {
	saveStream([note('root', 'short', [note('child', 'y'.repeat(50_000))])]);
	expect(loadStream()![0].children![0].content_markdown).toHaveLength(4_000);
});

test('a short body is left exactly as it was', () => {
	saveStream([note('a', 'still here')]);
	expect(loadStream()![0].content_markdown).toBe('still here');
});

test('the two tag lists are written by different pages and do not erase each other', () => {
	// The stream knows the counts, the root layout knows the ranking, and they
	// land at different times — whichever writes second must not blank the
	// other's half.
	saveAllTags([{ id: '1', name: 'blog', count: 3 }]);
	saveRecentTags([{ id: '1', name: 'blog' }]);

	expect(loadAllTags()).toEqual([{ id: '1', name: 'blog', count: 3 }]);
	expect(loadRecentTags()).toEqual([{ id: '1', name: 'blog' }]);

	saveAllTags([{ id: '2', name: 'idea', count: 1 }]);
	expect(loadRecentTags()).toEqual([{ id: '1', name: 'blog' }]);
});

test('a full disk drops the cache instead of failing the write', () => {
	saveStream([note('a')]);
	const original = localStorage.setItem;
	(globalThis as any).localStorage.setItem = () => {
		throw new Error('QuotaExceededError');
	};
	saveStream([note('b')]);
	(globalThis as any).localStorage.setItem = original;

	// The stale entry is gone rather than left behind claiming to be current.
	expect(loadStream()).toBeNull();
});

test('signing out takes the notes with it', () => {
	saveStream([note('a')]);
	saveAllTags([{ id: '1', name: 'blog', count: 3 }]);
	saveRecentTags([{ id: '1', name: 'blog' }]);

	clearCache();

	expect(loadStream()).toBeNull();
	expect(loadAllTags()).toBeNull();
	expect(loadRecentTags()).toBeNull();
});
