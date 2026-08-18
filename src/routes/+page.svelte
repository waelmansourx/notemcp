<script lang="ts">
	import NoteCard from '$lib/components/NoteCard.svelte';
	import { groupByRecency } from '$lib/dates';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let query = $state('');

	let filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return data.notes;
		return data.notes.filter((n) => {
			return (
				n.title.toLowerCase().includes(q) ||
				n.content_markdown.toLowerCase().includes(q) ||
				n.tags.some((t) => t.name.toLowerCase().includes(q)) ||
				(n.source_url ?? '').toLowerCase().includes(q)
			);
		});
	});

	let groups = $derived(groupByRecency(filtered));
</script>

<svelte:head>
	<title>NoteMCP</title>
</svelte:head>

<div class="safe-top safe-bottom mx-auto min-h-screen max-w-2xl px-4 pb-24">
	<header class="sticky top-0 z-10 -mx-4 px-4 pt-4 pb-2.5" style="background: var(--color-bg);">
		<div class="mb-2.5 flex items-center justify-between">
			<h1 class="text-xl font-semibold tracking-tight">Notes</h1>
			<a
				href="/account"
				aria-label="Account"
				class="flex h-9 w-9 items-center justify-center rounded-full"
				style="color: var(--color-ink-muted);"
			>
				<svg
					width="17"
					height="17"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
					><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg
				>
			</a>
		</div>
		<div class="relative">
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2"
				style="color: var(--color-ink-faint);"
				><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg
			>
			<input
				type="search"
				bind:value={query}
				placeholder="Search notes"
				class="w-full rounded-[var(--radius-md)] py-2.5 pr-4 pl-10 text-[0.95rem] outline-none"
				style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-ink);"
			/>
		</div>
	</header>

	{#if groups.length === 0}
		<div class="flex flex-col items-center gap-2 pt-24 text-center">
			<p class="font-medium" style="color: var(--color-ink-muted);">
				{query ? 'No matches' : 'Nothing here yet'}
			</p>
			{#if !query}
				<p class="text-sm" style="color: var(--color-ink-faint);">
					Share something into NoteMCP, or start a new note.
				</p>
			{/if}
		</div>
	{:else}
		<div class="flex flex-col gap-5">
			{#each groups as group (group.label)}
				<section>
					<h2
						class="mb-1.5 px-1 text-xs font-medium tracking-wide uppercase"
						style="color: var(--color-ink-faint);"
					>
						{group.label}
					</h2>
					<div class="flex flex-col gap-1.5">
						{#each group.notes as note (note.id)}
							<NoteCard {note} />
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}

	<a
		href="/note/new"
		aria-label="New note"
		class="fixed right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full active:scale-95"
		style="bottom: calc(env(safe-area-inset-bottom) + 1.25rem); background: var(--color-accent); color: var(--color-accent-ink); box-shadow: 0 8px 20px -4px color-mix(in srgb, var(--color-accent) 45%, transparent);"
	>
		<svg
			width="22"
			height="22"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.4"
			stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg
		>
	</a>
</div>
