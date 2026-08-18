/**
 * Tag colour is opt-in.
 *
 * At five tags a rainbow looks charming; at fifty it becomes a taxonomy you
 * have to decode. So every tag renders neutral unless the user has explicitly
 * given it a colour, and the palette is deliberately short — seven muted
 * options, each already contrast-checked against its own tint in layout.css.
 */
export const TAG_COLORS = ['green', 'indigo', 'amber', 'rose', 'slate', 'teal', 'violet'] as const;

export type TagColor = (typeof TAG_COLORS)[number];

export function isTagColor(value: unknown): value is TagColor {
	return typeof value === 'string' && (TAG_COLORS as readonly string[]).includes(value);
}

/** Class list for a tag chip. Neutral unless the tag carries a colour. */
export function tagClass(color?: string | null, size: 'sm' | 'lg' = 'sm'): string {
	const base = size === 'lg' ? 'tag tag-lg' : 'tag';
	return isTagColor(color) ? `${base} tag-${color}` : base;
}

/** Normalise user input into a stored tag name: lowercase, no leading #. */
export function normalizeTagName(input: string): string {
	return input.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-');
}
