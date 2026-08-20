/**
 * Tags render one way.
 *
 * There was a seven-colour palette here, opt-in per tag. It was never wired to
 * anything — the tags table has no colour column — and a library of fifty tags
 * in seven colours is a taxonomy you have to decode rather than read. A tag is
 * now what it looks like when you write it: the word, in the accent colour.
 */

/** Normalise user input into a stored tag name: lowercase, no leading #.
 *
 *  A `/` splits a tag into namespace segments ("features / Composer" ->
 *  "features/composer") — the same free-text `tags.name` column, just a
 *  convention for grouping, so nothing downstream of storage needs to know
 *  the difference between a plain tag and a namespaced one. */
export function normalizeTagName(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.split('/')
		.map((segment) => segment.trim().replace(/^#+/, '').replace(/\s+/g, '-'))
		.filter(Boolean)
		.join('/');
}

/** The first segment of a namespaced tag ("features/composer" -> "features"),
 *  or null for a tag with no namespace. */
export function tagNamespace(name: string): string | null {
	const i = name.indexOf('/');
	return i === -1 ? null : name.slice(0, i);
}

/** A tag reads exactly as it's stored, slashes and all: the `/` is the whole
 *  point of the convention, and swapping it for a prettier separator only
 *  hides the thing you typed. Kept as a seam because every surface that shows
 *  a tag goes through it. */
export function tagDisplay(name: string): string {
	return name;
}

/** The tail segment once the namespace is already said once elsewhere
 *  ("features/composer" -> "composer"). */
export function tagLeaf(name: string): string {
	const i = name.lastIndexOf('/');
	return i === -1 ? name : name.slice(i + 1);
}

/* ---------------- paths ----------------

   A `/` in a tag name is a convention, not a structure: there is no parent
   column on `tags` and no taxonomy to maintain, just a string that happens
   to read as a path. Everything below derives the hierarchy from the name
   itself, which is what keeps it lightweight — you can rename, split or
   flatten a tag by typing a different name, and nothing has to be migrated.

   The one rule that makes it useful: a tag *covers* everything beneath it.
   Writing `#notemcp/bug/share` files the thought under `#notemcp/bug` and
   `#notemcp` as well, so you never have to add all three by hand. */

export function tagSegments(name: string): string[] {
	return name.split('/').filter(Boolean);
}

/** How deep a tag sits: "notemcp" is 0, "notemcp/bug" is 1. */
export function tagDepth(name: string): number {
	return tagSegments(name).length - 1;
}

/** The path one level up ("notemcp/bug/share" -> "notemcp/bug"), or null at
 *  the top. */
export function tagParent(name: string): string | null {
	const i = name.lastIndexOf('/');
	return i === -1 ? null : name.slice(0, i);
}

/** Every path this tag files under, broadest first and including itself:
 *  "notemcp/bug/share" -> ["notemcp", "notemcp/bug", "notemcp/bug/share"]. */
export function tagAncestors(name: string): string[] {
	const segments = tagSegments(name);
	return segments.map((_, i) => segments.slice(0, i + 1).join('/'));
}

/**
 * Does filtering by `parent` include a note tagged `name`?
 *
 * Matching is by segment, never by raw string prefix — `#note` must not
 * swallow `#notemcp`, which is exactly what `startsWith` alone would do.
 */
export function tagCovers(parent: string, name: string): boolean {
	return name === parent || name.startsWith(parent + '/');
}

/**
 * Does filtering by `query` match a note tagged `name`?
 *
 * Looser than `tagCovers`, deliberately: you *browse* a tree but you *search*
 * across it. `#bug` finds `#notemcp/bug` and `#papilla/bug`, so a type you use
 * in every project is one tap rather than one tap per project — which is the
 * main thing paths buy you over a pile of flat tags.
 *
 * Still whole segments, and still contiguous: `#nm` doesn't match `#nmextra`,
 * and `#notemcp/share` doesn't match `#notemcp/bug/share` — a run of levels
 * you actually wrote, in the order you wrote them.
 */
export function tagMatchesSearch(query: string, name: string): boolean {
	return (
		name === query ||
		name.startsWith(query + '/') ||
		name.endsWith('/' + query) ||
		name.includes('/' + query + '/')
	);
}

/** Tags typed inline in freeform text ("caught up on #notemcp/bug/share
 *  today" -> ["notemcp/bug/share"]) — the caption-app convention, where the
 *  tag stays part of what you wrote instead of living in a separate field. */
const HASHTAG_RE = /#([a-z0-9][\w-]*(?:\/[a-z0-9][\w-]*)*)/gi;

export function extractHashtags(text: string): string[] {
	const names: string[] = [];
	for (const match of text.matchAll(HASHTAG_RE)) {
		const name = normalizeTagName(match[1]);
		if (name && !names.includes(name)) names.push(name);
	}
	return names;
}

export interface TagNode {
	/** The full path, which is also the tag's stored name. */
	name: string;
	/** Just this level ("share"), since the levels above are already on screen. */
	leaf: string;
	depth: number;
	children: TagNode[];
}

/**
 * Arrange tag names into the tree their paths imply.
 *
 * Intermediate levels are synthesised: a store whose only tag is
 * `notemcp/bug/share` still renders `notemcp` and `notemcp/bug` as places you
 * can tap, because a parent is a real destination whether or not anything was
 * ever tagged with it exactly.
 *
 * Order is first-seen rather than alphabetical, at every level, so a caller
 * that hands over tags sorted by recency gets a tree sorted by recency.
 */
export function tagTree(names: string[]): TagNode[] {
	const nodes = new Map<string, TagNode>();
	const roots: TagNode[] = [];

	function ensure(path: string): TagNode {
		const found = nodes.get(path);
		if (found) return found;

		const node: TagNode = { name: path, leaf: tagLeaf(path), depth: tagDepth(path), children: [] };
		nodes.set(path, node);

		const parent = tagParent(path);
		if (parent) ensure(parent).children.push(node);
		else roots.push(node);
		return node;
	}

	for (const name of names) {
		if (!name) continue;
		for (const path of tagAncestors(name)) ensure(path);
	}
	return roots;
}

/** The tree read top to bottom, parents immediately before their children —
 *  what a list of indented rows actually needs. */
export function flattenTagTree(nodes: TagNode[]): TagNode[] {
	const out: TagNode[] = [];
	for (const node of nodes) {
		out.push(node);
		out.push(...flattenTagTree(node.children));
	}
	return out;
}
