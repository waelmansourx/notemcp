<script lang="ts">
	import { onMount } from 'svelte';
	import type { EditorView } from '@codemirror/view';

	let {
		value = $bindable(''),
		placeholder = 'Write something…'
	}: { value?: string; placeholder?: string } = $props();

	let host: HTMLDivElement;
	let view = $state<EditorView | null>(null);

	onMount(() => {
		let cancelled = false;
		let instance: EditorView | null = null;

		// CodeMirror is browser-only and is the heaviest thing on this route,
		// so it's imported here rather than statically: the note's text is
		// already on screen (see the fallback below) by the time it arrives.
		import('$lib/editor/markdown-live').then(({ createMarkdownEditor }) => {
			if (cancelled) return;
			instance = createMarkdownEditor({
				parent: host,
				doc: value,
				placeholder,
				onChange: (next) => (value = next)
			});
			view = instance;
		});

		return () => {
			cancelled = true;
			instance?.destroy();
		};
	});

	// Reconcile edits made to `value` from outside the editor (the checklist
	// toggle in the header rewrites the whole document). Guarded on an actual
	// difference so the editor's own changes don't loop back into it.
	$effect(() => {
		const next = value;
		if (!view || next === view.state.doc.toString()) return;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: next }
		});
	});
</script>

<div class="editor-shell">
	<div bind:this={host} class="cm-host" class:hidden={!view}></div>

	{#if !view}
		<!-- Pre-hydration stand-in: same metrics as the editor, so the swap
		     when CodeMirror mounts doesn't shift the text. -->
		<div class="cm-fallback" aria-hidden="true">
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
