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

/** How a namespaced tag reads out loud, rather than the raw slash it's stored
 *  with: "features/composer" -> "features › composer". */
export function tagDisplay(name: string): string {
	return name.split('/').join(' › ');
}

/** The tail segment once the namespace is already said once elsewhere
 *  ("features/composer" -> "composer"). */
export function tagLeaf(name: string): string {
	const i = name.lastIndexOf('/');
	return i === -1 ? name : name.slice(i + 1);
}
