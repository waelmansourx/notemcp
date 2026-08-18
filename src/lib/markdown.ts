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
	const text = markdown
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/[#>*_`~-]/g, ' ')
		.replace(/\[(.*?)\]\(.*?\)/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
	return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
