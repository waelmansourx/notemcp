<script lang="ts">
	import { onMount } from 'svelte';
	import type { EditorView } from '@codemirror/view';
	import type { FormatAction } from '$lib/editor/markdown-live';

	let {
		value = $bindable(''),
		placeholder = 'Write something…',
		focused = $bindable(false),
		onlinkpaste,
		onimages,
		onchange
	}: {
		value?: string;
		placeholder?: string;
		focused?: boolean;
		onlinkpaste?: (url: string) => void;
		onimages?: (files: File[]) => void;
		onchange?: (value: string) => void;
	} = $props();

	let host: HTMLDivElement;
	let view = $state<EditorView | null>(null);
	let commands = $state<typeof import('$lib/editor/markdown-live').formatCommands | null>(null);

	// Set if the user taps the pre-hydration fallback before CodeMirror has
	// finished loading — on a cold start that gap is long enough to tap into,
	// and a tap on a plain, non-editable div otherwise just gets lost, leaving
	// the note looking unfocused with no keyboard up.
	let pendingFocus = false;
	function claimPendingFocus() {
		if (!view) pendingFocus = true;
	}

	// A rendered markdown image replaces its `![alt](url)` source in CodeMirror.
	// Letting the editor receive the initial press moves the caret into that
	// hidden source span, which immediately reveals the raw URL. Images in the
	// editor are display-only for now, so intercept the press before CodeMirror
	// can turn the thumbnail back into markdown text.
	function keepRenderedImageCollapsed(event: Event) {
		const target = event.target;
		if (!(target instanceof Element) || !target.closest('.cm-md-image')) return;
		event.preventDefault();
		event.stopPropagation();
	}

	onMount(() => {
		let cancelled = false;
		let instance: EditorView | null = null;

		host.addEventListener('pointerdown', keepRenderedImageCollapsed, true);
		host.addEventListener('mousedown', keepRenderedImageCollapsed, true);

		// CodeMirror is browser-only and is the heaviest thing on this route,
		// so it's imported here rather than statically: the note's text is
		// already on screen (see the fallback below) by the time it arrives.
		import('$lib/editor/markdown-live').then((module) => {
			if (cancelled) return;
			instance = module.createMarkdownEditor({
				parent: host,
				doc: value,
				placeholder,
				onChange: (next) => {
					value = next;
					onchange?.(next);
				},
				onFocusChange: (next) => (focused = next),
				onLinkPaste: onlinkpaste,
				onImages: onimages
			});
			view = instance;
			commands = module.formatCommands;
			if (pendingFocus) {
				pendingFocus = false;
				instance.focus();
			}
		});

		return () => {
			cancelled = true;
			host.removeEventListener('pointerdown', keepRenderedImageCollapsed, true);
			host.removeEventListener('mousedown', keepRenderedImageCollapsed, true);
			instance?.destroy();
		};
	});

	// Called by the formatting toolbar. Focus is restored afterwards because
	// the command runs from a button press, and on mobile losing the caret
	// would also dismiss the keyboard mid-edit.
	export function applyFormat(action: FormatAction) {
		if (!view || !commands) return;
		commands[action]({ state: view.state, dispatch: (tr) => view!.dispatch(tr) });
		view.focus();
	}

	// Focus editor and place caret at clicked coordinates or end of document.
	export function focusEditor(coords?: { x: number; y: number } | null) {
		if (!view) {
			pendingFocus = true;
			return;
		}
		view.focus();
		if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
			const pos = view.posAtCoords(coords);
			if (pos !== null) {
				view.dispatch({ selection: { anchor: pos, head: pos } });
				return;
			}
		}
		view.dispatch({ selection: { anchor: view.state.doc.length } });
	}

	export function insertBlock(markdown: string) {
		if (!view || !markdown) return;
		const range = view.state.selection.main;
		const before =
			range.from > 0 && view.state.sliceDoc(range.from - 1, range.from) !== '\n' ? '\n\n' : '';
		const after =
			range.to < view.state.doc.length && view.state.sliceDoc(range.to, range.to + 1) !== '\n'
				? '\n\n'
				: '';
		const insert = before + markdown + after;
		view.dispatch({
			changes: { from: range.from, to: range.to, insert },
			selection: { anchor: range.from + before.length + markdown.length },
			scrollIntoView: true
		});
		view.focus();
	}

	// Reconcile edits made to `value` from outside the editor. Guarded on an
	// actual difference so the editor's own changes don't loop back into it,
	// and skipped entirely while the editor has focus — external writes only
	// ever arrive while the user isn't typing.
	// The diff is trimmed to its changed middle rather than replacing the
	// whole document: a single from-0-to-end change maps every existing
	// selection into the replacement, which is what was throwing the caret
	// to the start or end of the note on every external rewrite.
	$effect(() => {
		const next = value;
		if (!view || view.hasFocus) return;
		const current = view.state.doc.toString();
		if (next === current) return;

		let start = 0;
		const maxStart = Math.min(current.length, next.length);
		while (start < maxStart && current[start] === next[start]) start++;

		let end = 0;
		const maxEnd = Math.min(current.length - start, next.length - start);
		while (end < maxEnd && current[current.length - 1 - end] === next[next.length - 1 - end]) {
			end++;
		}

		view.dispatch({
			changes: {
				from: start,
				to: current.length - end,
				insert: next.slice(start, next.length - end)
			}
		});
	});
</script>

<div class="editor-shell">
	<div bind:this={host} class="cm-host" class:hidden={!view}></div>

	{#if !view}
		<!-- Pre-hydration stand-in: same metrics as the editor, so the swap
		     when CodeMirror mounts doesn't shift the text. -->
		<div class="cm-fallback" aria-hidden="true" onpointerdown={claimPendingFocus}>
			{#if value}{value}{:else}<span style="color: var(--color-ink-faint);">{placeholder}</span
				>{/if}
		</div>
	{/if}
</div>

<style>
	/* The shell, the host and the editor all stretch so that tapping the
	   blank space under a short note still puts the caret in the document. */
	.editor-shell {
		position: relative;
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		width: 100%;
		cursor: text;
		min-height: 2.5rem;
	}

	.cm-host {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		width: 100%;
		cursor: text;
	}

	.cm-host :global(.cm-editor) {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		width: 100%;
		cursor: text;
	}

	.cm-host :global(.cm-scroller) {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		width: 100%;
		cursor: text;
	}

	.cm-host :global(.cm-content) {
		flex: 1 1 auto;
		width: 100%;
		cursor: text;
	}

	.cm-host :global(.cm-line) {
		width: 100%;
		cursor: text;
	}

	.cm-host :global(.cm-md-image),
	.cm-host :global(.cm-md-image img) {
		cursor: default;
	}

	.cm-fallback,
	.cm-host {
		font-family: var(--font-serif);
		font-size: 1rem;
		line-height: 1.65;
		white-space: pre-wrap;
		word-wrap: break-word;
	}

	.hidden {
		display: none;
	}
</style>
