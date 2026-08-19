<script lang="ts">
	import NoteEditor from '$lib/components/NoteEditor.svelte';
	import { firstLine } from '$lib/markdown';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title
		>{data.note.title.trim() || firstLine(data.note.content_markdown) || 'Note'} · NoteMCP</title
	>
</svelte:head>

{#key data.note.id}
	<NoteEditor existingNote={data.note} thread={data.thread} />
{/key}
