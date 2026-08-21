export function standaloneHttpUrl(text: string): string | null {
	const trimmed = text.trim();
	if (!trimmed || /\s/.test(trimmed)) return null;
	try {
		const url = new URL(trimmed);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
}

export function pastedLinkMarkdown(url: string, selectedText = ''): string {
	const parsed = new URL(url);
	const label = selectedText || parsed.hostname.replace(/^www\./, '');
	return `[${label}](${url})`;
}

export function pastedLinkEdit(document: string, from: number, to: number, url: string) {
	const before = document.slice(0, from);
	const after = document.slice(to);
	if (from === to && before.endsWith('](') && after.startsWith(')')) {
		return { from, to, insert: url };
	}
	if (from === to && before.endsWith('[') && after.startsWith(']()')) {
		return { from: from - 1, to: to + 3, insert: pastedLinkMarkdown(url) };
	}
	return { from, to, insert: pastedLinkMarkdown(url, document.slice(from, to)) };
}
