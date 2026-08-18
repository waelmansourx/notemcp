// Pure, dependency-free text helpers for summarising a note as plain text
// (list rows, document titles). Markdown is never converted to HTML anywhere
// in the app any more — the editor styles it in place instead — so nothing
// here needs a parser.

export const TASK_ITEM_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s)/;

export function firstLine(markdown: string, max = 80): string {
	const line = markdown
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l.length > 0);
	if (!line) return '';
	const stripped = line.replace(/^#+\s*/, '');
	return stripped.length > max ? stripped.slice(0, max - 1) + '…' : stripped;
}

/** Pulls a leading `![](...)` image off a note's content, e.g. one embedded
 *  by the composer's photo button or the share-target flow. Returns the rest
 *  of the text untouched so the feed can show a thumbnail instead of the raw
 *  (often base64, always noisy) markdown. */
export function extractLeadingImage(markdown: string): { image: string | null; rest: string } {
	const trimmed = markdown.trimStart();
	const match = trimmed.match(/^!\[[^\]]*\]\(([^)]+)\)/);
	if (!match) return { image: null, rest: markdown };
	return { image: match[1], rest: trimmed.slice(match[0].length) };
}

export function snippet(markdown: string, max = 140): string {
	const text = plainText(markdown);
	return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/** Markdown reduced to readable prose on one line. Images go first and whole:
 *  an embedded photo is a base64 data URL running to megabytes, and putting
 *  one of those in a list row is how the tags page came to render several
 *  megabytes of text and fall over. */
export function plainText(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[(.*?)\]\([^)]*\)/g, '$1')
		.replace(/[#>*_`~-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** A note's own text, kept multi-line but cut to what a stream row can hold.
 *  Line breaks survive — the shape of a list is part of how you recognise a
 *  note at a glance — but the tail of a long note doesn't belong in a list of
 *  many notes. */
export function excerpt(markdown: string, max = 320): string {
	const text = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const wrap = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
	return (wrap > max * 0.6 ? cut.slice(0, wrap) : cut).trimEnd() + '…';
}
