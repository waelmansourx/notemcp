import { describe, expect, test } from 'bun:test';
import { previewImageFor } from './preview-image';

describe('previewImageFor', () => {
	test('prefers the computed compact preview', () => {
		expect(
			previewImageFor({
				preview_image: '/api/media/abc',
				source_image: 'https://example.com/source.jpg',
				source_url: 'https://example.com'
			})
		).toBe('/api/media/abc');
	});

	test('falls back to a saved source thumbnail', () => {
		expect(
			previewImageFor({ source_image: 'https://example.com/source.jpg', source_url: null })
		).toBe('https://example.com/source.jpg');
	});

	test('derives a YouTube thumbnail when metadata was not saved', () => {
		expect(
			previewImageFor({ source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
		).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
		expect(previewImageFor({ source_url: 'https://youtu.be/dQw4w9WgXcQ?t=12' })).toBe(
			'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
		);
	});

	test('does not invent thumbnails for unrelated links', () => {
		expect(previewImageFor({ source_url: 'https://example.com/article' })).toBeNull();
	});
});
