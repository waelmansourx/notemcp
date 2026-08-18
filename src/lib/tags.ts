/**
 * Tags render one way.
 *
 * There was a seven-colour palette here, opt-in per tag. It was never wired to
 * anything — the tags table has no colour column — and a library of fifty tags
 * in seven colours is a taxonomy you have to decode rather than read. A tag is
 * now what it looks like when you write it: the word, in the accent colour.
 */

/** Normalise user input into a stored tag name: lowercase, no leading #. */
export function normalizeTagName(input: string): string {
	return input.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-');
}
