import { test, expect } from 'bun:test';
import { excerpt, plainText, snippet, extractLeadingImage } from './markdown';
import { groupByDay, streamDate } from './dates';
import { normalizeTagName } from './tags';

const big = 'data:image/jpeg;base64,' + 'A'.repeat(200_000);

test('plainText drops embedded data URLs entirely', () => {
	const out = plainText(`![](${big})\n\nreal words here`);
	expect(out).toBe('real words here');
	expect(out.includes('base64')).toBe(false);
});

test('snippet never leaks a data URL', () => {
	expect(snippet(`![](${big})\n\nhello`).length).toBeLessThan(200);
	expect(snippet(`![](${big})`)).toBe('');
});

test('excerpt strips images and caps length', () => {
	expect(excerpt(`![](${big})\n\nshort note`)).toBe('short note');
	const long = 'word '.repeat(400);
	expect(excerpt(long).length).toBeLessThanOrEqual(321);
	expect(excerpt(long).endsWith('…')).toBe(true);
});

test('excerpt keeps newlines so list shape survives', () => {
	expect(excerpt('- a\n- b\n- c')).toBe('- a\n- b\n- c');
});

test('excerpt leaves short notes untouched', () => {
	expect(excerpt('just a thought')).toBe('just a thought');
});

test('extractLeadingImage still works alongside excerpt', () => {
	const { image, rest } = extractLeadingImage(`![](${big})\n\ncaption`);
	expect(image).toBe(big);
	expect(rest.trim()).toBe('caption');
});

const note = (over: any = {}) => ({
	id: 'n',
	user_id: 'u',
	title: '',
	content_markdown: '',
	source_url: null,
	source_type: null,
	source_title: null,
	source_description: null,
	source_image: null,
	folder_id: null,
	pinned: false,
	archived: false,
	created_at: '2020-01-01T10:00:00Z',
	updated_at: '2020-01-01T10:00:00Z',
	deleted_at: null,
	tags: [],
	...over
});

test('streamDate prefers last activity', () => {
	expect(streamDate(note({ updated_at: '2026-08-18T10:00:00Z' }))).toBe('2026-08-18T10:00:00Z');
	expect(streamDate(note({ updated_at: '' }))).toBe('2020-01-01T10:00:00Z');
});

test('an edited old note groups under the day it was edited', () => {
	const today = new Date().toISOString();
	const groups = groupByDay([
		note({ id: 'old-but-edited', created_at: '2020-01-01T10:00:00Z', updated_at: today }),
		note({
			id: 'untouched',
			created_at: '2020-01-01T10:00:00Z',
			updated_at: '2020-01-01T10:00:00Z'
		})
	]);
	expect(groups[0].label).toBe('Today');
	expect(groups[0].notes[0].id).toBe('old-but-edited');
	expect(groups[1].notes[0].id).toBe('untouched');
});

test('tag names normalise the way the filter expects', () => {
	expect(normalizeTagName('  #Landing Page ')).toBe('landing-page');
	expect(normalizeTagName('##Bugs')).toBe('bugs');
	expect(normalizeTagName('   ')).toBe('');
});
