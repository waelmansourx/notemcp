/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { EditorSelection, EditorState } from '@codemirror/state';
import {
	continueList,
	formatCommands,
	parseImageSpan,
	taskToggleEdit,
	type FormatAction
} from './markdown-live';

// `|` marks the caret. Returns the document with the caret marked again, or
// null when the command declines to handle the key (letting CodeMirror's own
// Enter run instead).
function pressEnter(docWithCaret: string): string | null {
	const head = docWithCaret.indexOf('|');
	let state = EditorState.create({
		doc: docWithCaret.replace('|', ''),
		selection: { anchor: head }
	});

	const handled = continueList({
		state,
		dispatch: (tr) => {
			state = tr.state;
		}
	});
	if (!handled) return null;

	const text = state.doc.toString();
	const caret = state.selection.main.head;
	return text.slice(0, caret) + '|' + text.slice(caret);
}

describe('continueList', () => {
	test('continues a task item with an unchecked box', () => {
		expect(pressEnter('- [ ] milk|')).toBe('- [ ] milk\n- [ ] |');
	});

	test('starts the next item unchecked even after a checked one', () => {
		expect(pressEnter('- [x] milk|')).toBe('- [x] milk\n- [ ] |');
	});

	test('ends the list when Enter is pressed on an empty item', () => {
		expect(pressEnter('- [ ] milk\n- [ ] |')).toBe('- [ ] milk\n|');
		expect(pressEnter('- milk\n- |')).toBe('- milk\n|');
	});

	test('continues plain and ordered lists', () => {
		expect(pressEnter('- milk|')).toBe('- milk\n- |');
		expect(pressEnter('* star|')).toBe('* star\n* |');
		expect(pressEnter('1. one|')).toBe('1. one\n2. |');
	});

	test('preserves indentation and the ordered delimiter', () => {
		expect(pressEnter('  3) three|')).toBe('  3) three\n  4) |');
		expect(pressEnter('    - deep|')).toBe('    - deep\n    - |');
	});

	test('splits the item when Enter lands mid-text', () => {
		expect(pressEnter('- mi|lk')).toBe('- mi\n- |lk');
	});

	test('declines outside a list, and inside a list marker', () => {
		expect(pressEnter('just text|')).toBeNull();
		expect(pressEnter('- [ ]| milk')).toBeNull();
		expect(pressEnter('|- milk')).toBeNull();
	});
});

// Runs a toolbar command over `doc`, optionally with the given selection,
// and returns the resulting text (with `|` marking the caret when asked).
function format(
	action: FormatAction,
	doc: string,
	selection?: { anchor: number; head: number },
	showCaret = false
): string {
	let state = EditorState.create({
		doc,
		selection: selection
			? EditorSelection.single(selection.anchor, selection.head)
			: EditorSelection.cursor(doc.length)
	});
	formatCommands[action]({
		state,
		dispatch: (tr) => {
			state = tr.state;
		}
	});
	const text = state.doc.toString();
	if (!showCaret) return text;
	const caret = state.selection.main.head;
	return text.slice(0, caret) + '|' + text.slice(caret);
}

describe('toolbar block commands', () => {
	test('the checkbox button toggles a task on and off', () => {
		expect(format('task', 'milk')).toBe('- [ ] milk');
		expect(format('task', '- [ ] milk')).toBe('milk');
	});

	test('block markers replace each other rather than stacking', () => {
		expect(format('task', '- milk')).toBe('- [ ] milk');
		expect(format('bullet', '- [ ] milk')).toBe('- milk');
		expect(format('heading', '- [ ] hi')).toBe('# hi');
	});

	test('indentation survives a toggle', () => {
		expect(format('task', '   milk')).toBe('   - [ ] milk');
	});

	test('the heading button cycles plain -> H1 -> H2 -> plain', () => {
		expect(format('heading', 'hi')).toBe('# hi');
		expect(format('heading', '# hi')).toBe('## hi');
		expect(format('heading', '## hi')).toBe('hi');
	});

	test('applies to every line the selection touches', () => {
		expect(format('task', 'a\nb\nc', { anchor: 0, head: 5 })).toBe('- [ ] a\n- [ ] b\n- [ ] c');
	});

	// The caret sits at the start of the line whenever a button is tapped on a
	// fresh or empty line, which is exactly when a marker inserted at that same
	// position can end up *after* the caret — so the next thing typed lands in
	// front of it (`text- [ ] `) instead of inside the item.
	test('leaves the caret after a marker inserted at the caret', () => {
		expect(format('task', '', { anchor: 0, head: 0 }, true)).toBe('- [ ] |');
		expect(format('bullet', '', { anchor: 0, head: 0 }, true)).toBe('- |');
		expect(format('heading', '', { anchor: 0, head: 0 }, true)).toBe('# |');
	});

	test('leaves the caret after the marker on an existing line', () => {
		expect(format('task', 'milk', { anchor: 0, head: 0 }, true)).toBe('- [ ] |milk');
		expect(format('heading', 'hi', { anchor: 0, head: 0 }, true)).toBe('# |hi');
	});

	test('keeps the caret with its text when a marker is removed', () => {
		expect(format('task', '- [ ] milk', { anchor: 6, head: 6 }, true)).toBe('|milk');
	});
});

describe('toolbar inline commands', () => {
	test('bold wraps a selection and unwraps it again', () => {
		expect(format('bold', 'milk', { anchor: 0, head: 4 })).toBe('**milk**');
		expect(format('bold', '**milk**', { anchor: 2, head: 6 })).toBe('milk');
	});

	test('bold with no selection leaves the caret between the markers', () => {
		expect(format('bold', 'x', undefined, true)).toBe('x**|**');
	});

	test('link puts the caret where the next thing to type goes', () => {
		expect(format('link', '', undefined, true)).toBe('[|]()');
		expect(format('link', 'site', { anchor: 0, head: 4 }, true)).toBe('[site](|)');
	});
});

describe('taskToggleEdit', () => {
	test('flips the box in both directions', () => {
		expect(taskToggleEdit('- [ ] milk')).toEqual({ offset: 3, insert: 'x' });
		expect(taskToggleEdit('- [x] milk')).toEqual({ offset: 3, insert: ' ' });
		expect(taskToggleEdit('- [X] milk')).toEqual({ offset: 3, insert: ' ' });
	});

	test('accounts for indentation when locating the box', () => {
		expect(taskToggleEdit('   - [ ] milk')).toEqual({ offset: 6, insert: 'x' });
	});

	test('ignores lines that are not tasks', () => {
		expect(taskToggleEdit('- milk')).toBeNull();
		expect(taskToggleEdit('plain text')).toBeNull();
	});
});

describe('parseImageSpan', () => {
	test("splits an image node's text into alt and url", () => {
		expect(parseImageSpan('![](/api/media/abc)')).toEqual({ alt: '', url: '/api/media/abc' });
		expect(parseImageSpan('![a photo](/api/media/abc)')).toEqual({
			alt: 'a photo',
			url: '/api/media/abc'
		});
	});

	test('tolerates a title and discards it', () => {
		expect(parseImageSpan('![](/api/media/abc "a title")')).toEqual({
			alt: '',
			url: '/api/media/abc'
		});
	});

	test('declines anything that is not exactly an image span', () => {
		expect(parseImageSpan('[link](/x)')).toBeNull();
		expect(parseImageSpan('![broken(/x)')).toBeNull();
		expect(parseImageSpan('not an image at all')).toBeNull();
	});
});
