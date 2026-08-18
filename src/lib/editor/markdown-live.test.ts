/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { continueList, taskToggleEdit } from './markdown-live';

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
