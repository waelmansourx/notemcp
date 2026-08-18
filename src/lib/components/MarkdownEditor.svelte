<script lang="ts">
	import { onMount } from 'svelte';
	import type { EditorView } from '@codemirror/view';
	import type { FormatAction } from '$lib/editor/markdown-live';

	let {
		value = $bindable(''),
		placeholder = 'Write something…',
		focused = $bindable(false)
	}: { value?: string; placeholder?: string; focused?: boolean } = $props();

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

	onMount(() => {
		let cancelled = false;
		let instance: EditorView | null = null;

		// CodeMirror is browser-only and is the heaviest thing on this route,
		// so it's imported here rather than statically: the note's text is
		// already on screen (see the fallback below) by the time it arrives.
		import('$lib/editor/markdown-live').then((module) => {
			if (cancelled) return;
			instance = module.createMarkdownEditor({
				parent: host,
				doc: value,
				placeholder,
				onChange: (next) => (value = next),
				onFocusChange: (next) => (focused = next)
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

	// Lets the title field hand the caret over on Enter.
	export function focusEditor() {
		if (!view) return;
		view.focus();
		view.dispatch({ selection: { anchor: view.state.doc.length } });
	}

	// Reconcile edits made to `value` from outside the editor (the checklist
	// toggle in the header rewrites the whole document). Guarded on an actual
	// difference so the editor's own changes don't loop back into it, and
	// skipped entirely while the editor has focus — the only external writer
	// is a header button, which always blurs the editor first, so this only
	// ever needs to run against a doc the user isn't actively typing into.
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
	   blank space under a short note still puts the caret in the document —
	   otherwise only the line of text itself is a target. */
	.editor-shell {
		position: relative;
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: 40vh;
		/* Breathing room so the last line never sits under the sticky tag bar. */
		padding-bottom: 1.5rem;
	}

	.cm-host {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
	}

	.cm-host :global(.cm-editor) {
		flex: 1 1 auto;
	}

	.cm-fallback,
	.cm-host {
		font-size: 1rem;
		line-height: 1.65;
		white-space: pre-wrap;
		word-wrap: break-word;
	}

	.hidden {
		display: none;
	}
</style>
