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
