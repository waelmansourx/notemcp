<script lang="ts">
	import NoteEditor from '$lib/components/NoteEditor.svelte';
	import { page } from '$app/state';

	let prefill = $derived({
		title: page.url.searchParams.get('title') ?? '',
		content_markdown: page.url.searchParams.get('content') ?? '',
		source_url: page.url.searchParams.get('source_url') || null,
		source_title: page.url.searchParams.get('source_title') || null,
		source_description: page.url.searchParams.get('source_description') || null,
		source_image: page.url.searchParams.get('source_image') || null
	});
</script>

<svelte:head>
	<title>New note · NoteMCP</title>
</svelte:head>

<NoteEditor {prefill} />
