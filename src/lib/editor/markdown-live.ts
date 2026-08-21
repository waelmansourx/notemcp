import {
	EditorView,
	Decoration,
	WidgetType,
	ViewPlugin,
	keymap,
	placeholder as placeholderExt,
	type DecorationSet,
	type ViewUpdate
} from '@codemirror/view';
import {
	EditorSelection,
	EditorState,
	Prec,
	type ChangeSpec,
	type Range,
	type StateCommand
} from '@codemirror/state';
import { Language, defineLanguageFacet, languageDataProp, syntaxTree } from '@codemirror/language';
import { parser as commonmarkParser, TaskList, Strikethrough, Autolink } from '@lezer/markdown';
import { pastedLinkEdit, standaloneHttpUrl } from '$lib/links';
import {
	history,
	historyKeymap,
	defaultKeymap,
	undo as historyUndo,
	redo as historyRedo
} from '@codemirror/commands';

// A Bear-style "live" markdown editor: there is no preview mode, because the
// text you type is already styled in place. Syntax markers (#, **, `) stay
// visible but dimmed, so the document is never lying about what it contains
// and nothing reflows when the caret moves.
//
// This is deliberately not a WYSIWYG engine. Every decoration below is
// derived from the syntax tree on each update and thrown away — the note's
// source of truth is always the plain markdown string.

// The language is assembled from @lezer/markdown directly rather than via
// @codemirror/lang-markdown, which depends on @codemirror/lang-html and so
// drags in the full JavaScript and CSS grammars plus the autocomplete
// package — ~120kB gzipped of parsers for embedded code blocks that a notes
// app will never render. Only the three GFM extensions that earn their place
// here are enabled; tables are deliberately left out.
const markdownData = defineLanguageFacet({
	commentTokens: { block: { open: '<!--', close: '-->' } }
});

const markdownLanguage = new Language(
	markdownData,
	commonmarkParser.configure([
		TaskList,
		Strikethrough,
		Autolink,
		{ props: [languageDataProp.add({ Document: markdownData })] }
	]),
	[],
	'markdown'
);

const HEADING_LEVEL: Record<string, number> = {
	ATXHeading1: 1,
	ATXHeading2: 2,
	ATXHeading3: 3,
	ATXHeading4: 4,
	ATXHeading5: 5,
	ATXHeading6: 6
};

// The punctuation that makes markdown markdown. Dimmed rather than hidden so
// the text doesn't jump around as the caret enters and leaves a span.
const SYNTAX_MARKS = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'LinkMark', 'QuoteMark']);

const MARKER_DECO = Decoration.mark({ class: 'cm-md-marker' });
const LIST_MARK_DECO = Decoration.mark({ class: 'cm-md-list-mark' });
const STRONG_DECO = Decoration.mark({ class: 'cm-md-strong' });
const EMPHASIS_DECO = Decoration.mark({ class: 'cm-md-emphasis' });
const STRIKE_DECO = Decoration.mark({ class: 'cm-md-strike' });
const INLINE_CODE_DECO = Decoration.mark({ class: 'cm-md-inline-code' });
const LINK_DECO = Decoration.mark({ class: 'cm-md-link' });
const URL_DECO = Decoration.mark({ class: 'cm-md-url' });
const HIDDEN_DECO = Decoration.replace({});
const CODE_LINE_DECO = Decoration.line({ class: 'cm-md-code-line' });
const QUOTE_LINE_DECO = Decoration.line({ class: 'cm-md-quote-line' });

class TaskCheckboxWidget extends WidgetType {
	constructor(readonly checked: boolean) {
		super();
	}

	eq(other: TaskCheckboxWidget) {
		return other.checked === this.checked;
	}

	toDOM() {
		const box = document.createElement('input');
		box.type = 'checkbox';
		box.checked = this.checked;
		box.className = 'cm-md-task-checkbox';
		box.setAttribute('aria-label', this.checked ? 'Mark as not done' : 'Mark as done');
		return box;
	}

	// Let the click reach the view's own handlers (see toggleTaskAt below)
	// instead of being swallowed as an ordinary widget interaction.
	ignoreEvent() {
		return false;
	}
}

/** Exported for tests: an `Image` node's own text (`![alt](url)`, as sliced
 *  straight from the syntax tree) split into its alt text and url, or null
 *  if the span isn't exactly that shape — a title in quotes is tolerated and
 *  discarded, everything else declines rather than guessing. */
export function parseImageSpan(text: string): { alt: string; url: string } | null {
	const match = text.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
	if (!match) return null;
	return { alt: match[1], url: match[2] };
}

class ImageWidget extends WidgetType {
	constructor(
		readonly url: string,
		readonly alt: string
	) {
		super();
	}

	eq(other: ImageWidget) {
		return other.url === this.url && other.alt === this.alt;
	}

	toDOM() {
		const wrap = document.createElement('span');
		wrap.className = 'cm-md-image';
		const img = document.createElement('img');
		img.src = this.url;
		img.alt = this.alt;
		img.loading = 'lazy';
		wrap.appendChild(img);
		return wrap;
	}
}

function decorate(view: EditorView): DecorationSet {
	const ranges: Range<Decoration>[] = [];
	const { doc } = view.state;

	// Replacing document text with something else — hiding a list mark, or
	// swapping `[ ]` for a checkbox widget — pulls the DOM out from under an
	// in-progress IME composition and corrupts what gets typed. Android opens
	// a composition for nearly every word, so during one the replacements are
	// held back, but only where they'd actually touch the caret.
	//
	// Styling marks (bold, headings, links) are deliberately NOT suppressed:
	// they wrap text rather than replace it, so composition survives them, and
	// blanking a whole line's styling on every keystroke reads as a flicker.
	const composingAt = view.compositionStarted ? view.state.selection.main.head : null;
	const disturbsComposition = (from: number, to: number) =>
		composingAt !== null && from <= composingAt && to >= composingAt;

	// Only the visible viewport is decorated — a long note stays cheap to
	// scroll because offscreen lines never build decorations at all.
	for (const { from, to } of view.visibleRanges) {
		syntaxTree(view.state).iterate({
			from,
			to,
			enter: (node) => {
				const name = node.name;
				const level = HEADING_LEVEL[name];

				if (level) {
					ranges.push(
						Decoration.line({ class: `cm-md-h${level}` }).range(doc.lineAt(node.from).from)
					);
					return;
				}

				if (SYNTAX_MARKS.has(name)) {
					ranges.push(MARKER_DECO.range(node.from, node.to));
					return;
				}

				switch (name) {
					case 'StrongEmphasis':
						ranges.push(STRONG_DECO.range(node.from, node.to));
						break;
					case 'Emphasis':
						ranges.push(EMPHASIS_DECO.range(node.from, node.to));
						break;
					case 'Strikethrough':
						ranges.push(STRIKE_DECO.range(node.from, node.to));
						break;
					case 'InlineCode':
						ranges.push(INLINE_CODE_DECO.range(node.from, node.to));
						break;
					case 'Link':
						ranges.push(LINK_DECO.range(node.from, node.to));
						break;
					case 'URL':
						ranges.push(URL_DECO.range(node.from, node.to));
						break;
					case 'Image': {
						// The caret has to be able to get inside `![alt](url)` to edit
						// it, so a span the cursor is currently in (or that IME is mid
						// composition over) is left as plain, editable markdown text —
						// only an image nobody is touching collapses to its thumbnail.
						if (disturbsComposition(node.from, node.to)) break;
						const head = view.state.selection.main.head;
						// Losing focus entirely (tapping the title, another
						// thought, the tag bar) has to collapse it too — the
						// selection itself doesn't move just because focus left,
						// so without this an image typed at the very end of the
						// document would stay raw text forever once you tab away.
						if (view.hasFocus && head >= node.from && head <= node.to) break;
						const parsed = parseImageSpan(doc.sliceString(node.from, node.to));
						if (!parsed) break;
						ranges.push(
							Decoration.replace({ widget: new ImageWidget(parsed.url, parsed.alt) }).range(
								node.from,
								node.to
							)
						);
						// The widget already stands for everything inside this span —
						// walking into its LinkMark/URL children would emit ordinary
						// mark decorations over text that's being replaced.
						return false;
					}
					case 'ListMark': {
						// A task's bullet is redundant next to its checkbox, so hide
						// it; a plain bullet is kept and tinted instead.
						const item = node.node.parent;
						const isTask = item?.name === 'ListItem' && !!item.getChild('Task');
						const hide = isTask && !disturbsComposition(node.from, node.to);
						ranges.push(
							hide
								? HIDDEN_DECO.range(node.from, node.to)
								: LIST_MARK_DECO.range(node.from, node.to)
						);
						break;
					}
					case 'TaskMarker': {
						if (disturbsComposition(node.from, node.to)) break;
						const checked = doc.sliceString(node.from, node.to).toLowerCase().includes('x');
						ranges.push(
							Decoration.replace({ widget: new TaskCheckboxWidget(checked) }).range(
								node.from,
								node.to
							)
						);
						break;
					}
					case 'FencedCode':
					case 'CodeBlock': {
						const first = doc.lineAt(node.from).number;
						const last = doc.lineAt(node.to).number;
						for (let n = first; n <= last; n++) {
							ranges.push(CODE_LINE_DECO.range(doc.line(n).from));
						}
						break;
					}
					case 'Blockquote': {
						const first = doc.lineAt(node.from).number;
						const last = doc.lineAt(node.to).number;
						for (let n = first; n <= last; n++) {
							ranges.push(QUOTE_LINE_DECO.range(doc.line(n).from));
						}
						break;
					}
				}
			}
		});
	}

	// Sorting is left to Decoration.set rather than a RangeSetBuilder: line
	// decorations are emitted at their line's start, which can precede the
	// node that triggered them, so the tree walk alone isn't strictly ordered.
	return Decoration.set(ranges, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		composing: boolean;

		constructor(view: EditorView) {
			this.decorations = decorate(view);
			this.composing = view.compositionStarted;
		}

		update(update: ViewUpdate) {
			const composing = update.view.compositionStarted;
			// Composition starting/ending changes what decorate() should skip
			// even when nothing else about the update would have triggered a
			// redecorate (e.g. Android opens a composition just by placing the
			// cursor in a word, with no doc change yet).
			if (
				update.docChanged ||
				update.viewportChanged ||
				update.selectionSet ||
				// A blur with no other change still has to re-run decorate(): an
				// image the caret was sitting inside collapses to its thumbnail
				// only once the editor has actually lost focus (see the Image
				// case above), and nothing else here would trigger that redraw.
				update.focusChanged ||
				composing !== this.composing
			) {
				this.decorations = decorate(update.view);
			}
			this.composing = composing;
		}
	},
	{ decorations: (plugin) => plugin.decorations }
);

const TASK_BOX_RE = /^(\s*[-*+]\s+\[)([ xX])(\])/;

// Exported for tests: given a line, where does its checkbox character sit and
// what should replace it? Kept free of both the view and the document so the
// toggle can be exercised without a DOM.
export function taskToggleEdit(lineText: string): { offset: number; insert: string } | null {
	const match = lineText.match(TASK_BOX_RE);
	if (!match) return null;
	return { offset: match[1].length, insert: match[2] === ' ' ? 'x' : ' ' };
}

// Tapping a rendered checkbox rewrites the `[ ]` / `[x]` it stands for. The
// position is resolved from the DOM at click time rather than captured when
// the widget was built, so edits elsewhere in the note can't misdirect it.
function toggleTaskAt(view: EditorView, target: HTMLElement): boolean {
	const line = view.state.doc.lineAt(view.posAtDOM(target));
	const edit = taskToggleEdit(line.text);
	if (!edit) return false;

	const at = line.from + edit.offset;
	view.dispatch({ changes: { from: at, to: at + 1, insert: edit.insert } });
	return true;
}

const LIST_PREFIX_RE = /^(\s*)(?:([-*+])\s+(\[[ xX]\]\s+)?|(\d+)([.)])\s+)/;

// Enter continues whatever list you're in, and a second Enter on an empty
// item ends it — the two behaviours that make a checklist feel native rather
// than like markdown you have to retype. Typed as a StateCommand (rather than
// taking an EditorView) so it needs only state + dispatch, which also makes it
// directly testable without a DOM.
export const continueList: StateCommand = ({ state, dispatch }) => {
	const range = state.selection.main;
	if (!range.empty) return false;

	const line = state.doc.lineAt(range.head);
	const match = line.text.match(LIST_PREFIX_RE);
	if (!match) return false;

	const prefixLength = match[0].length;
	// Only continue from the end of the item; mid-line Enter should just split.
	if (range.head < line.from + prefixLength) return false;

	const rest = line.text.slice(prefixLength);
	if (rest.trim() === '') {
		dispatch(
			state.update({
				changes: { from: line.from, to: line.from + prefixLength, insert: '' },
				selection: { anchor: line.from }
			})
		);
		return true;
	}

	const [, indent, bullet, task, ordinal, delimiter] = match;
	const next = bullet
		? `${indent}${bullet} ${task ? '[ ] ' : ''}`
		: `${indent}${Number(ordinal) + 1}${delimiter} `;

	const insert = '\n' + next;
	dispatch(
		state.update({
			changes: { from: range.head, insert },
			selection: { anchor: range.head + insert.length },
			scrollIntoView: true
		})
	);
	return true;
};

// Whatever block marker a line already carries. The alternation is ordered
// so that a task's `- [ ] ` is matched before the bare `- ` inside it.
const BLOCK_RE = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;

function classifyMarker(marker: string): string {
	if (!marker) return 'none';
	if (/^#{1,6}\s/.test(marker)) return `h${marker.trim().length}`;
	if (/\[[ xX]\]/.test(marker)) return 'task';
	if (/^\d/.test(marker)) return 'ordered';
	return 'bullet';
}

// Applies a block marker across every line the selection touches, swapping
// out whatever marker was there. Tapping the same button again clears it, so
// each button is a toggle rather than a one-way conversion.
function toggleBlock(kind: 'task' | 'bullet' | 'ordered' | 'heading'): StateCommand {
	return ({ state, dispatch }) => {
		const changes: ChangeSpec[] = [];
		const { from, to } = state.selection.main;

		for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) {
			const line = state.doc.line(n);
			const match = line.text.match(BLOCK_RE);
			const indent = match?.[1] ?? '';
			const marker = match?.[2] ?? '';
			const current = classifyMarker(marker);

			let next: string;
			if (kind === 'heading') {
				// One button, two useful levels: plain → H1 → H2 → plain.
				next = current === 'h1' ? '## ' : current === 'h2' ? '' : '# ';
			} else if (kind === 'task') {
				next = current === 'task' ? '' : '- [ ] ';
			} else if (kind === 'ordered') {
				next = current === 'ordered' ? '' : '1. ';
			} else {
				next = current === 'bullet' ? '' : '- ';
			}

			if (marker === next) continue;
			const start = line.from + indent.length;
			changes.push({ from: start, to: start + marker.length, insert: next });
		}

		if (!changes.length) return false;
		// The caret is mapped with assoc = 1 so that it ends up *after* a marker
		// inserted at its own position. With CodeMirror's default (assoc = -1) a
		// caret at the start of the line — which is where it sits whenever the
		// button is tapped on an empty or fresh line — stays in front of the
		// marker, and everything typed next lands before it (`text- [ ] `).
		const changeSet = state.changes(changes);
		dispatch(
			state.update({
				changes: changeSet,
				selection: state.selection.map(changeSet, 1),
				scrollIntoView: true
			})
		);
		return true;
	};
}

// Wraps the selection in `**`, or unwraps it when the delimiters are already
// there. With no selection it inserts an empty pair and puts the caret
// between them, so the button works as "start typing bold".
const toggleBold: StateCommand = ({ state, dispatch }) => {
	dispatch(
		state.update(
			state.changeByRange((range) => {
				const wrapped =
					state.sliceDoc(range.from - 2, range.from) === '**' &&
					state.sliceDoc(range.to, range.to + 2) === '**';

				if (wrapped) {
					return {
						changes: [
							{ from: range.from - 2, to: range.from },
							{ from: range.to, to: range.to + 2 }
						],
						range: EditorSelection.range(range.from - 2, range.to - 2)
					};
				}

				const text = state.sliceDoc(range.from, range.to);
				return {
					changes: { from: range.from, to: range.to, insert: `**${text}**` },
					range: EditorSelection.range(range.from + 2, range.to + 2)
				};
			}),
			{ scrollIntoView: true }
		)
	);
	return true;
};

function toggleInline(marker: string): StateCommand {
	return ({ state, dispatch }) => {
		dispatch(
			state.update(
				state.changeByRange((range) => {
					const size = marker.length;
					const wrapped =
						state.sliceDoc(Math.max(0, range.from - size), range.from) === marker &&
						state.sliceDoc(range.to, range.to + size) === marker;

					if (wrapped) {
						return {
							changes: [
								{ from: range.from - size, to: range.from },
								{ from: range.to, to: range.to + size }
							],
							range: EditorSelection.range(range.from - size, range.to - size)
						};
					}

					const text = state.sliceDoc(range.from, range.to);
					return {
						changes: { from: range.from, to: range.to, insert: `${marker}${text}${marker}` },
						range: EditorSelection.range(range.from + size, range.to + size)
					};
				}),
				{ scrollIntoView: true }
			)
		);
		return true;
	};
}

// `[text](|)` when something is selected, `[|]()` when nothing is — either
// way the caret lands where the next thing to type goes.
const insertLink: StateCommand = ({ state, dispatch }) => {
	dispatch(
		state.update(
			state.changeByRange((range) => {
				const text = state.sliceDoc(range.from, range.to);
				const insert = `[${text}]()`;
				const caret = range.from + (text ? insert.length - 1 : 1);
				return {
					changes: { from: range.from, to: range.to, insert },
					range: EditorSelection.cursor(caret)
				};
			}),
			{ scrollIntoView: true }
		)
	);
	return true;
};

export const formatCommands = {
	task: toggleBlock('task'),
	bullet: toggleBlock('bullet'),
	ordered: toggleBlock('ordered'),
	heading: toggleBlock('heading'),
	bold: toggleBold,
	italic: toggleInline('*'),
	code: toggleInline('`'),
	link: insertLink,
	undo: historyUndo,
	redo: historyRedo
} satisfies Record<string, StateCommand>;

export type FormatAction = keyof typeof formatCommands;

const theme = EditorView.theme({
	'&': {
		color: 'var(--color-ink)',
		backgroundColor: 'transparent',
		fontSize: '1rem',
		width: '100%',
		cursor: 'text'
	},
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': {
		fontFamily: 'var(--font-serif)',
		lineHeight: '1.65',
		cursor: 'text',
		width: '100%'
	},
	'.cm-content': {
		padding: '0',
		fontFamily: 'var(--font-serif)',
		lineHeight: '1.65',
		caretColor: 'var(--color-accent)',
		cursor: 'text',
		width: '100%',
		minHeight: '100%'
	},
	'.cm-line': {
		padding: '0',
		cursor: 'text',
		width: '100%'
	},
	'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)' },
	'.cm-placeholder': { color: 'var(--color-ink-faint)', cursor: 'text' },
	'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
		backgroundColor: 'var(--color-accent-soft)'
	},

	'.cm-md-marker': { color: 'var(--color-ink-faint)', fontWeight: '400' },
	'.cm-md-list-mark': { color: 'var(--color-accent)' },
	'.cm-md-strong': { fontWeight: '650' },
	'.cm-md-emphasis': { fontStyle: 'italic' },
	'.cm-md-strike': { textDecoration: 'line-through', color: 'var(--color-ink-muted)' },
	'.cm-md-inline-code': {
		fontFamily: 'var(--font-mono)',
		fontSize: '0.875em',
		background: 'var(--color-surface-2)',
		borderRadius: '0.35em',
		padding: '0.1em 0.15em'
	},
	'.cm-md-link': { color: 'var(--color-accent)' },
	'.cm-md-url': { color: 'var(--color-ink-faint)' },

	'.cm-md-h1': {
		fontSize: '1.5em',
		fontWeight: '600',
		lineHeight: '1.3',
		letterSpacing: '-0.01em'
	},
	'.cm-md-h2': {
		fontSize: '1.25em',
		fontWeight: '600',
		lineHeight: '1.3',
		letterSpacing: '-0.01em'
	},
	'.cm-md-h3': { fontSize: '1.1em', fontWeight: '600', lineHeight: '1.35' },
	'.cm-md-h4, .cm-md-h5, .cm-md-h6': { fontWeight: '600' },

	'.cm-md-code-line': {
		fontFamily: 'var(--font-mono)',
		fontSize: '0.85em',
		background: 'var(--color-surface-2)'
	},
	'.cm-md-quote-line': {
		borderLeft: '3px solid var(--color-border)',
		paddingLeft: '0.85em',
		color: 'var(--color-ink-muted)'
	},

	'.cm-md-image': {
		display: 'block',
		margin: '0.3em 0'
	},
	'.cm-md-image img': {
		display: 'block',
		maxWidth: '100%',
		maxHeight: '22rem',
		borderRadius: 'var(--radius-lg, 0.9rem)',
		objectFit: 'cover'
	},

	'.cm-md-task-checkbox': {
		width: '1.05em',
		height: '1.05em',
		accentColor: 'var(--color-accent)',
		verticalAlign: '-0.15em',
		marginRight: '0.15em',
		cursor: 'pointer'
	}
});

/**
 * Keep the caret on screen while typing.
 *
 * CodeMirror scrolls its own scroller, but this editor has no height of its
 * own — the page scrolls. Combined with a software keyboard covering the
 * bottom of the window and a toolbar pinned above it, pressing Enter could
 * leave the new line underneath both, so you'd type blind and have to scroll
 * by hand to see what you'd written. The visual viewport is the only thing
 * that knows where the keyboard actually ends, so the check is made against
 * that and the page is nudged just far enough.
 */
const CARET_MARGIN = 104;

const keepCaretVisible = EditorView.updateListener.of((update) => {
	if (!update.docChanged && !update.selectionSet) return;
	if (!update.view.hasFocus) return;

	// After the DOM has been written, or the coordinates describe the layout
	// as it was before this change.
	requestAnimationFrame(() => {
		const view = update.view;
		if (!view.dom.isConnected || !view.hasFocus) return;

		const caret = view.coordsAtPos(view.state.selection.main.head);
		if (!caret) return;

		const vv = window.visualViewport;
		const top = vv ? vv.offsetTop : 0;
		const bottom = top + (vv ? vv.height : window.innerHeight);

		const below = caret.bottom - (bottom - CARET_MARGIN);
		if (below > 0) {
			window.scrollBy({ top: below, behavior: 'smooth' });
			return;
		}

		// The title field and the sticky header live up here, so the caret
		// needs clearance at the top too.
		const above = caret.top - (top + 12);
		if (above < 0) window.scrollBy({ top: above, behavior: 'smooth' });
	});
});

export function createMarkdownEditor(options: {
	parent: HTMLElement;
	doc: string;
	placeholder?: string;
	onChange: (value: string) => void;
	onFocusChange?: (focused: boolean) => void;
	onLinkPaste?: (url: string) => void;
	onImages?: (files: File[]) => void;
}): EditorView {
	const view = new EditorView({
		parent: options.parent,
		state: EditorState.create({
			doc: options.doc,
			extensions: [
				// Deliberately not `basicSetup` — line numbers, folding, bracket
				// matching and autocompletion all belong to a code editor, not a
				// notes app, and each one is bundle weight for a feature nobody
				// asked for here.
				history(),
				Prec.high(keymap.of([{ key: 'Enter', run: continueList }])),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				markdownLanguage,
				EditorView.lineWrapping,
				livePreviewPlugin,
				theme,
				placeholderExt(options.placeholder ?? ''),
				EditorView.domEventHandlers({
					paste(event, view) {
						const images = Array.from(event.clipboardData?.files ?? []).filter((file) =>
							file.type.startsWith('image/')
						);
						if (images.length > 0 && options.onImages) {
							event.preventDefault();
							options.onImages(images);
							return true;
						}
						const url = standaloneHttpUrl(event.clipboardData?.getData('text/plain') ?? '');
						if (!url) return false;
						event.preventDefault();
						const range = view.state.selection.main;
						const edit = pastedLinkEdit(view.state.doc.toString(), range.from, range.to, url);
						view.dispatch({
							changes: edit,
							selection: { anchor: edit.from + edit.insert.length },
							scrollIntoView: true
						});
						options.onLinkPaste?.(url);
						return true;
					},
					drop(event) {
						const images = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
							file.type.startsWith('image/')
						);
						if (images.length === 0 || !options.onImages) return false;
						event.preventDefault();
						options.onImages(images);
						return true;
					},
					click(event, view) {
						const target = event.target as HTMLElement;
						if (!target.classList?.contains('cm-md-task-checkbox')) return false;
						event.preventDefault();
						return toggleTaskAt(view, target);
					}
				}),
				keepCaretVisible,
				EditorView.updateListener.of((update) => {
					if (update.docChanged) options.onChange(update.state.doc.toString());
					if (update.focusChanged) options.onFocusChange?.(update.view.hasFocus);
				})
			]
		})
	});

	return view;
}
