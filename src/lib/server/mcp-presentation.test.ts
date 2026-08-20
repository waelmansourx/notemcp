import { describe, expect, it } from 'bun:test';
import {
	compactMcpNote,
	imageToolResult,
	presentMcpPayload,
	richMcpNote,
	toolResult
} from './mcp-presentation';

const caption = `FULL-INSTAGRAM-CAPTION ${'caption text '.repeat(250)}`;

const importedShare = {
	id: 'note-1',
	label: `Dr. Gerrit Schaefer on Instagram: ${caption}`,
	title: `Dr. Gerrit Schaefer on Instagram: ${caption}`,
	preview: 'Nice ad format',
	content_markdown: 'Nice ad format',
	source_url: 'https://www.instagram.com/p/example/',
	source_type: 'share',
	source_title: `Dr. Gerrit Schaefer on Instagram: ${caption}`,
	source_description: caption,
	source_image: 'https://cdninstagram.example/large-preview.jpg',
	pinned: false,
	archived: false,
	parent_id: null,
	thread_count: 0,
	tags: ['inspo'],
	created_at: '2026-08-20T10:00:00.000Z',
	updated_at: '2026-08-20T10:00:00.000Z'
};

describe('compact MCP notes', () => {
	it('keeps the user annotation first-class without dumping imported captions', () => {
		const note = compactMcpNote(importedShare);
		const serialized = JSON.stringify(note);

		expect(note.user_text).toBe('Nice ad format');
		expect(note.label).toBe('Nice ad format');
		expect(note.source).toEqual({
			type: 'share',
			domain: 'instagram.com',
			title: expect.stringMatching(/^Dr\. Gerrit Schaefer on Instagram/),
			url: 'https://www.instagram.com/p/example/',
			image_available: true
		});
		expect(note).not.toHaveProperty('title');
		expect(note).not.toHaveProperty('preview');
		expect(note).not.toHaveProperty('source_description');
		expect(note).not.toHaveProperty('source_image');
		expect(serialized).not.toContain(caption);
		expect(serialized.length).toBeLessThan(700);
	});

	it('maps user_text only from the authored-content preview', () => {
		const note = compactMcpNote({
			...importedShare,
			preview: '',
			source_description: 'Imported words must not become the thought'
		});

		expect(note.user_text).toBeNull();
		expect(note.label).not.toBe('Imported words must not become the thought');
	});

	it('makes a continuation relationship explicit in compact results', () => {
		const note = compactMcpNote({
			...importedShare,
			id: 'continuation',
			parent_id: 'thread-head',
			root_id: 'thread-head',
			is_thread_head: false,
			thread_count: 5
		});

		expect(note).toMatchObject({
			id: 'continuation',
			root_id: 'thread-head',
			parent_id: 'thread-head',
			is_thread_head: false,
			thread_count: 5
		});
	});
});

describe('rich MCP notes', () => {
	it('keeps source metadata once in the canonical nested shape', () => {
		const note = richMcpNote(importedShare) as Record<string, any>;

		expect(note.user_text).toBe('Nice ad format');
		expect(note.source.description).toBe(caption);
		expect(note.source.image_available).toBe(true);
		expect(note.source).not.toHaveProperty('image');
		expect(note).not.toHaveProperty('title');
		expect(note).not.toHaveProperty('preview');
		expect(note).not.toHaveProperty('source_description');
		expect(note).not.toHaveProperty('source_image');
		expect(note.content_markdown).toBe('Nice ad format');
	});

	it('enriches every continuation in a fetched thread', () => {
		const note = richMcpNote({
			...importedShare,
			thread: [{ ...importedShare, id: 'note-2' }]
		}) as Record<string, any>;

		expect(note.thread[0].user_text).toBe('Nice ad format');
		expect(note.thread[0].source.description).toBe(caption);
	});
});

describe('MCP structured output', () => {
	function textContent(result: ReturnType<typeof toolResult>): string {
		const content = result.content[0];
		if (content.type !== 'text') throw new Error('expected text content');
		return content.text;
	}

	it('returns native note objects and preserves the legacy serialized array', () => {
		const payload = presentMcpPayload('search_notes', {}, [importedShare]);
		const result = toolResult('search_notes', payload);

		expect(result.structuredContent).toEqual({ notes: payload });
		expect(JSON.parse(textContent(result))).toEqual(payload);
		expect(textContent(result)).not.toContain(caption);
	});

	it('keeps a 20-note imported-source page bounded', () => {
		const rows = Array.from({ length: 20 }, (_, index) => ({
			...importedShare,
			id: `note-${index}`
		}));
		const payload = presentMcpPayload('list_recent_notes', {}, rows);
		const result = toolResult('list_recent_notes', payload);

		expect((result.structuredContent.notes as any[]).length).toBe(20);
		expect(textContent(result)).not.toContain(caption);
		expect(textContent(result).length).toBeLessThan(14_000);
	});

	it('honors the existing full opt-in while keeping structured output native', () => {
		const payload = presentMcpPayload('list_recent_notes', { full: true }, [importedShare]);
		const result = toolResult('list_recent_notes', payload);

		expect((result.structuredContent.notes as any[])[0].source.description).toBe(caption);
		expect(JSON.parse(textContent(result))[0].source.description).toBe(caption);
		expect(JSON.parse(textContent(result))[0]).not.toHaveProperty('source_description');
	});

	it('returns image bytes as MCP image content without duplicating them in structured metadata', () => {
		const result = imageToolResult(
			{ note_id: 'note-1', mime_type: 'image/webp' },
			{ data: 'aW1hZ2U=', mimeType: 'image/webp' }
		);

		expect(result.content[1]).toEqual({
			type: 'image',
			data: 'aW1hZ2U=',
			mimeType: 'image/webp'
		});
		expect(result.structuredContent).not.toHaveProperty('data');
	});
});
