import { describe, expect, it } from 'bun:test';
import {
	extractHashtags,
	flattenTagTree,
	normalizeTagName,
	tagAncestors,
	tagCovers,
	tagDepth,
	tagDisplay,
	tagLeaf,
	tagMatchesSearch,
	tagNamespace,
	tagParent,
	tagTree
} from './tags';

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

describe('extractHashtags', () => {
	it('finds a hashtag typed inline in a sentence', () => {
		expect(extractHashtags('caught up on #notemcp/bug/share today')).toEqual([
			'notemcp/bug/share'
		]);
	});

	it('returns nothing for plain text', () => {
		expect(extractHashtags('just a thought, no tags')).toEqual([]);
	});

	it('dedupes repeats and preserves first-seen order', () => {
		expect(extractHashtags('#idea then #bug then #idea again')).toEqual(['idea', 'bug']);
	});

	it('does not treat a bare # as a tag', () => {
		expect(extractHashtags('issue #123 needs a # placeholder')).toEqual(['123']);
	});

	it('normalizes case the same way a typed tag would', () => {
		expect(extractHashtags('#Idea')).toEqual(['idea']);
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
	it('keeps the slash a path tag was written with', () => {
		expect(tagDisplay('features/composer')).toBe('features/composer');
	});

	it('leaves a plain tag untouched', () => {
		expect(tagDisplay('idea')).toBe('idea');
	});
});

describe('tagMatchesSearch', () => {
	it('matches the tag itself', () => {
		expect(tagMatchesSearch('notemcp/bug', 'notemcp/bug')).toBe(true);
	});

	it('matches downwards, like tagCovers', () => {
		expect(tagMatchesSearch('notemcp', 'notemcp/bug/share')).toBe(true);
		expect(tagMatchesSearch('notemcp/bug', 'notemcp/bug/share')).toBe(true);
	});

	it('matches a leaf across projects, which tagCovers deliberately does not', () => {
		expect(tagMatchesSearch('bug', 'notemcp/bug')).toBe(true);
		expect(tagMatchesSearch('bug', 'papilla/bug')).toBe(true);
		expect(tagCovers('bug', 'notemcp/bug')).toBe(false);
	});

	it('matches a level in the middle', () => {
		expect(tagMatchesSearch('bug', 'notemcp/bug/share')).toBe(true);
	});

	it('matches a contiguous run of levels', () => {
		expect(tagMatchesSearch('bug/share', 'notemcp/bug/share')).toBe(true);
	});

	it('will not skip a level to make a match', () => {
		expect(tagMatchesSearch('notemcp/share', 'notemcp/bug/share')).toBe(false);
	});

	it('still matches whole segments only', () => {
		expect(tagMatchesSearch('nm', 'nmextra')).toBe(false);
		expect(tagMatchesSearch('bug', 'debugging')).toBe(false);
		expect(tagMatchesSearch('ug', 'notemcp/bug')).toBe(false);
	});
});

describe('tagParent / tagDepth', () => {
	it('walks one level up', () => {
		expect(tagParent('notemcp/bug/share')).toBe('notemcp/bug');
		expect(tagParent('notemcp')).toBeNull();
	});

	it('counts depth from zero at the top', () => {
		expect(tagDepth('notemcp')).toBe(0);
		expect(tagDepth('notemcp/bug')).toBe(1);
		expect(tagDepth('notemcp/bug/share')).toBe(2);
	});
});

describe('tagAncestors', () => {
	it('lists every path a tag files under, broadest first, including itself', () => {
		expect(tagAncestors('notemcp/bug/share')).toEqual([
			'notemcp',
			'notemcp/bug',
			'notemcp/bug/share'
		]);
	});

	it('is just the tag itself when there is no path', () => {
		expect(tagAncestors('idea')).toEqual(['idea']);
	});
});

describe('tagCovers', () => {
	it('covers itself', () => {
		expect(tagCovers('notemcp', 'notemcp')).toBe(true);
	});

	it('covers everything beneath it, at any depth', () => {
		expect(tagCovers('notemcp', 'notemcp/bug')).toBe(true);
		expect(tagCovers('notemcp', 'notemcp/bug/share')).toBe(true);
		expect(tagCovers('notemcp/bug', 'notemcp/bug/share')).toBe(true);
	});

	it('does not cover a sibling, or a parent from a child', () => {
		expect(tagCovers('notemcp/bug', 'notemcp/idea')).toBe(false);
		expect(tagCovers('notemcp/bug/share', 'notemcp/bug')).toBe(false);
	});

	it('matches whole segments, so #note does not swallow #notemcp', () => {
		expect(tagCovers('note', 'notemcp')).toBe(false);
		expect(tagCovers('note', 'notemcp/bug')).toBe(false);
	});
});

describe('tagTree', () => {
	it('nests tags by their path', () => {
		const roots = tagTree(['notemcp/bug', 'notemcp/idea', 'papilla/content']);
		expect(roots.map((r) => r.name)).toEqual(['notemcp', 'papilla']);
		expect(roots[0].children.map((c) => c.leaf)).toEqual(['bug', 'idea']);
		expect(roots[1].children.map((c) => c.leaf)).toEqual(['content']);
	});

	it('synthesises levels nothing was tagged with exactly', () => {
		// The only tag is three deep; the two above it are still real places.
		const flat = flattenTagTree(tagTree(['notemcp/bug/share']));
		expect(flat.map((n) => n.name)).toEqual(['notemcp', 'notemcp/bug', 'notemcp/bug/share']);
	});

	it('does not duplicate a level reached by two different tags', () => {
		const roots = tagTree(['notemcp/bug/share', 'notemcp/bug/editor']);
		expect(roots).toHaveLength(1);
		expect(roots[0].children).toHaveLength(1);
		expect(roots[0].children[0].children.map((n) => n.leaf)).toEqual(['share', 'editor']);
	});

	it('keeps first-seen order so a recency-sorted input stays recency-sorted', () => {
		const roots = tagTree(['papilla/content', 'notemcp/bug']);
		expect(roots.map((r) => r.name)).toEqual(['papilla', 'notemcp']);
	});

	it('handles plain tags alongside namespaced ones', () => {
		const roots = tagTree(['idea', 'notemcp/bug']);
		expect(roots.map((r) => r.name)).toEqual(['idea', 'notemcp']);
		expect(roots[0].children).toEqual([]);
	});
});

describe('flattenTagTree', () => {
	it('reads parents immediately before their children', () => {
		const flat = flattenTagTree(tagTree(['a/b/c', 'a/d', 'e']));
		expect(flat.map((n) => n.name)).toEqual(['a', 'a/b', 'a/b/c', 'a/d', 'e']);
	});

	it('carries the depth each row should be indented by', () => {
		const flat = flattenTagTree(tagTree(['a/b/c']));
		expect(flat.map((n) => n.depth)).toEqual([0, 1, 2]);
	});
});
