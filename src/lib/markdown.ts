// Pure, dependency-free text helpers. NoteCard and the note list import only
// this file, so keep it free of marked/highlight.js — those are heavy (the
// full highlight.js build alone is ~1MB) and previously rode along into the
// list page's bundle just because renderMarkdown lived in the same module.
// The actual HTML renderer lives in markdown-render.ts and is only imported
// by the editor, which is the one place that needs it.

export const TASK_ITEM_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s)/;

export function toggleTaskLine(markdown: string, index: number): string {
	let count = -1;
	return markdown
		.split('\n')
		.map((line) => {
			const match = line.match(TASK_ITEM_RE);
			if (!match) return line;
			count++;
			if (count !== index) return line;
			const next = match[2] === ' ' ? 'x' : ' ';
			return line.slice(0, match[1].length) + next + line.slice(match[1].length + 1);
		})
		.join('\n');
}

export function firstLine(markdown: string, max = 80): string {
	const line = markdown
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l.length > 0);
	if (!line) return '';
	const stripped = line.replace(/^#+\s*/, '');
	return stripped.length > max ? stripped.slice(0, max - 1) + '…' : stripped;
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
