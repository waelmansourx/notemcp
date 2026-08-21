import { test, expect, beforeEach, afterEach } from 'bun:test';

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

const { queueNote, queueEdit, removeEdit, hasQueuedEdit, flushEdits, flushOutbox } =
	await import('./outbox');

const realFetch = globalThis.fetch;

/** Record every request and answer them all the same way. */
function stubFetch(reply: (url: string, init: RequestInit) => { ok: boolean; status?: number }) {
	const calls: { url: string; body: any; method?: string }[] = [];
	(globalThis as any).fetch = async (url: string, init: RequestInit = {}) => {
		calls.push({
			url,
			method: init.method,
			body: init.body ? JSON.parse(init.body as string) : null
		});
		const { ok, status } = reply(url, init);
		return {
			ok,
			status: status ?? (ok ? 200 : 500),
			json: async () => ({ id: 'server-1', updated_at: '2026-08-20T10:00:00.000Z' })
		} as any;
	};
	return calls;
}

beforeEach(() => store.clear());
afterEach(() => {
	(globalThis as any).fetch = realFetch;
});

function entry(over: Record<string, unknown> = {}) {
	return {
		title: '',
		content_markdown: 'hello',
		source_url: null,
		source_type: null,
		source_title: null,
		source_description: null,
		source_image: null,
		parent_id: null,
		tagNames: [],
		...over
	} as any;
}

/* ---------------- creates ---------------- */

test('re-queueing the same client id replaces rather than duplicates', () => {
	queueNote(entry({ client_id: 'c1', content_markdown: 'first' }));
	queueNote(entry({ client_id: 'c1', content_markdown: 'second' }));

	const queued = JSON.parse(store.get('notemcp:outbox')!);
	expect(queued).toHaveLength(1);
	expect(queued[0].content_markdown).toBe('second');
});

test('a note queued without a client id still gets one', () => {
	const queued = queueNote(entry());
	expect(typeof queued.client_id).toBe('string');
	expect(queued.client_id.length).toBeGreaterThan(0);
});

test('a voice note keeps its R2 media metadata but never sends its local blob URL', async () => {
	queueNote(
		entry({
			client_id: 'voice-1',
			source_type: 'voice',
			voice: {
				media_id: '11111111-1111-4111-8111-111111111111',
				duration_ms: 17_250,
				waveform: [8, 42, 73, 20],
				local_url: 'blob:http://localhost/private-device-copy'
			}
		})
	);
	const calls = stubFetch(() => ({ ok: true }));

	await flushOutbox();

	expect(calls).toHaveLength(1);
	expect(calls[0].body.voice).toEqual({
		media_id: '11111111-1111-4111-8111-111111111111',
		duration_ms: 17_250,
		waveform: [8, 42, 73, 20]
	});
});

/* ---------------- edits ---------------- */

test('an edit is queued under its note id', () => {
	queueEdit('n1', { title: 'T' });
	expect(hasQueuedEdit('n1')).toBe(true);
	expect(hasQueuedEdit('n2')).toBe(false);
});

test('repeated edits to one note merge into a single pending patch', () => {
	queueEdit('n1', { title: 'first', content_markdown: 'body' });
	queueEdit('n1', { title: 'second' });

	const queued = JSON.parse(store.get('notemcp:edits')!);
	expect(queued).toHaveLength(1);
	// Newest value of each field, and a field only touched once survives.
	expect(queued[0].patch).toEqual({ title: 'second', content_markdown: 'body' });
});

test('edits to different notes stay separate', () => {
	queueEdit('n1', { title: 'a' });
	queueEdit('n2', { title: 'b' });
	expect(JSON.parse(store.get('notemcp:edits')!)).toHaveLength(2);
});

test('removing an edit leaves the others alone', () => {
	queueEdit('n1', { title: 'a' });
	queueEdit('n2', { title: 'b' });
	removeEdit('n1');
	expect(hasQueuedEdit('n1')).toBe(false);
	expect(hasQueuedEdit('n2')).toBe(true);
});

test('flushing PATCHes each queued edit and clears it', async () => {
	queueEdit('n1', { title: 'T', content_markdown: 'body' });
	const calls = stubFetch(() => ({ ok: true }));

	await flushEdits();

	expect(calls).toHaveLength(1);
	expect(calls[0].url).toBe('/api/notes/n1');
	expect(calls[0].method).toBe('PATCH');
	expect(calls[0].body).toEqual({ title: 'T', content_markdown: 'body' });
	expect(hasQueuedEdit('n1')).toBe(false);
});

test('a flushed edit also drops the draft it was holding', async () => {
	const { saveDraft, readDraft } = await import('./draft.svelte');
	saveDraft('n1', { title: 'T', content: 'body', tags: [] });
	queueEdit('n1', { title: 'T' });
	stubFetch(() => ({ ok: true }));

	await flushEdits();

	expect(readDraft('n1')).toBeNull();
});

test('an edit that fails to send stays queued, and keeps its draft', async () => {
	const { saveDraft, readDraft } = await import('./draft.svelte');
	saveDraft('n1', { title: 'T', content: 'body', tags: [] });
	queueEdit('n1', { title: 'T' });
	(globalThis as any).fetch = async () => {
		throw new Error('offline');
	};

	await flushEdits();

	expect(hasQueuedEdit('n1')).toBe(true);
	expect(readDraft('n1')).not.toBeNull();
});

test('an edit to a note deleted elsewhere is dropped rather than retried forever', async () => {
	queueEdit('n1', { title: 'T' });
	stubFetch(() => ({ ok: false, status: 404 }));

	await flushEdits();

	expect(hasQueuedEdit('n1')).toBe(false);
});

test('a server error keeps the edit for the next attempt', async () => {
	queueEdit('n1', { title: 'T' });
	stubFetch(() => ({ ok: false, status: 500 }));

	await flushEdits();

	expect(hasQueuedEdit('n1')).toBe(true);
});

test('an edit stale beyond the retry window is abandoned without sending', async () => {
	const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
	store.set(
		'notemcp:edits',
		JSON.stringify([{ note_id: 'n1', patch: { title: 'T' }, queued_at: old }])
	);
	const calls = stubFetch(() => ({ ok: true }));

	await flushEdits();

	expect(calls).toHaveLength(0);
	expect(hasQueuedEdit('n1')).toBe(false);
});

test('a queued create is sent before any queued edit to it could be', async () => {
	// Ordering matters: patching a note the server has never seen would 404
	// and the edit would be thrown away.
	queueNote(entry({ client_id: 'c1' }));
	queueEdit('n1', { title: 'T' });
	const calls = stubFetch(() => ({ ok: true }));

	await flushOutbox();
	await flushEdits();

	expect(calls.map((c) => c.method)).toEqual(['POST', 'PATCH']);
});
