<script lang="ts">
	import Composer from '$lib/components/Composer.svelte';
	import DayHeading from '$lib/components/DayHeading.svelte';
	import Entry from '$lib/components/Entry.svelte';
	import { groupByDay } from '$lib/dates';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let groups = $derived(groupByDay(data.notes));
</script>

<svelte:head><title>#{data.name} · NoteMCP</title></svelte:head>

<div class="safe-top mx-auto min-h-screen max-w-[42rem] overflow-x-hidden px-[22px] pb-36">
	<header class="flex items-center gap-3 pt-5 pb-3">
		<a
			href="/tags"
			aria-label="Back to tags"
			class="grid h-9 w-9 shrink-0 place-items-center rounded-full active:scale-95"
			style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-ink-2);"
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
				<path d="m15 18-6-6 6-6" />
			</svg>
		</a>
		<div class="min-w-0 flex-1">
			<h1 class="truncate font-serif text-[2rem] leading-none font-medium tracking-[-0.025em]">
				<span style="color: var(--color-ink-faint); font-weight: 400;">#</span>{data.name}
			</h1>
			<p class="mt-1 text-[0.74rem]" style="color: var(--color-ink-faint);">
				{data.notes.length} {data.notes.length === 1 ? 'thought' : 'thoughts'}
			</p>
		</div>
	</header>

	{#if groups.length === 0}
		<p class="pt-24 text-center text-[0.94rem]" style="color: var(--color-ink-muted);">
			Nothing is filed here yet.
		</p>
	{:else}
		{#each groups as group (group.key)}
			<DayHeading label={group.label} />
			{#each group.notes as note (note.id)}
				<Entry {note} showTime />
			{/each}
		{/each}
	{/if}
</div>

<Composer />
