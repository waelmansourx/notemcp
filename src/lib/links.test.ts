import { describe, expect, test } from 'bun:test';
import { pastedLinkEdit, pastedLinkMarkdown, standaloneHttpUrl } from './links';

describe('pasted links', () => {
	test('accepts only standalone http(s) URLs', () => {
		expect(standaloneHttpUrl('https://example.com/path')).toBe('https://example.com/path');
		expect(standaloneHttpUrl('javascript:alert(1)')).toBeNull();
		expect(standaloneHttpUrl('see https://example.com')).toBeNull();
	});

	test('uses the host as the visible label, or the selected text when present', () => {
		expect(pastedLinkMarkdown('https://www.example.com/path')).toBe(
			'[example.com](https://www.example.com/path)'
		);
		expect(pastedLinkMarkdown('https://example.com/', 'reference')).toBe(
			'[reference](https://example.com/)'
		);
	});

	test('fills a toolbar-created link instead of nesting another link inside it', () => {
		expect(pastedLinkEdit('[reference]()', 12, 12, 'https://example.com/')).toEqual({
			from: 12,
			to: 12,
			insert: 'https://example.com/'
		});
		expect(pastedLinkEdit('[]()', 1, 1, 'https://example.com/')).toEqual({
			from: 0,
			to: 4,
			insert: '[example.com](https://example.com/)'
		});
	});
});
