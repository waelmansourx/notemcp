import { describe, expect, it } from 'bun:test';
import { normalizeTagName, tagDisplay, tagLeaf, tagNamespace } from './tags';

describe('normalizeTagName', () => {
	it('lowercases, trims, and drops a leading #', () => {
		expect(normalizeTagName('  #Idea  ')).toBe('idea');
	});

	it('turns internal whitespace into dashes', () => {
		expect(normalizeTagName('landing page')).toBe('landing-page');
	});

	it('normalizes each segment of a namespaced tag', () => {
		expect(normalizeTagName('Features / Composer')).toBe('features/composer');
		expect(normalizeTagName('#bugs / Landing Page')).toBe('bugs/landing-page');
	});

	it('drops empty segments rather than leaving stray slashes', () => {
		expect(normalizeTagName('features//composer')).toBe('features/composer');
		expect(normalizeTagName('/features/')).toBe('features');
	});

	it('returns empty for input that is only punctuation or whitespace', () => {
		expect(normalizeTagName('   ')).toBe('');
		expect(normalizeTagName('#')).toBe('');
	});
});

describe('tagNamespace', () => {
	it('is the first segment of a namespaced tag', () => {
		expect(tagNamespace('features/composer')).toBe('features');
	});

	it('is null for a tag with no namespace', () => {
		expect(tagNamespace('idea')).toBeNull();
	});
});

describe('tagLeaf', () => {
	it('is the tail segment of a namespaced tag', () => {
		expect(tagLeaf('features/composer')).toBe('composer');
	});

	it('is the whole name when there is no namespace', () => {
		expect(tagLeaf('idea')).toBe('idea');
	});
});

describe('tagDisplay', () => {
	it('renders a namespaced tag with a separator instead of the raw slash', () => {
		expect(tagDisplay('features/composer')).toBe('features › composer');
	});

	it('leaves a plain tag untouched', () => {
		expect(tagDisplay('idea')).toBe('idea');
	});
});
