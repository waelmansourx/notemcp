import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

const marked = new Marked(
	markedHighlight({
		emptyLangClass: 'hljs',
		langPrefix: 'hljs language-',
		highlight(code, lang) {
			const language = hljs.getLanguage(lang) ? lang : 'plaintext';
			return hljs.highlight(code, { language }).value;
		}
	})
);

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(source: string): string {
	if (!source.trim()) return '';
	return marked.parse(source, { async: false }) as string;
}

// GFM task-list checkboxes render `disabled` by default. Swap that for a
// data-task-index so the editor's preview can make them tappable — turning
// `- [ ]` lines into an actual todo list instead of static markup.
export function renderMarkdownWithTasks(source: string): string {
	const html = renderMarkdown(source);
	if (!html) return html;
	let i = 0;
	return html.replace(/<input ([^>]*)type="checkbox">/g, (_match, attrs) => {
		const cleaned = attrs.replace(/disabled=""\s*/, '').trim();
		return `<input ${cleaned ? cleaned + ' ' : ''}type="checkbox" data-task-index="${i++}">`;
	});
}

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
