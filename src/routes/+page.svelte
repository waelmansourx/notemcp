<script lang="ts">
	import Entry from '$lib/components/Entry.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import StreamNav from '$lib/components/StreamNav.svelte';
	import DayHeading from '$lib/components/DayHeading.svelte';
	import { groupByDay } from '$lib/dates';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let groups = $derived(groupByDay(data.notes));

	// Days the reader has explicitly asked to see times for.
	let revealed = $state<number[]>([]);
	function toggleDay(key: number) {
		revealed = revealed.includes(key) ? revealed.filter((k) => k !== key) : [...revealed, key];
	}
</script>

<svelte:head><title>NoteMCP</title></svelte:head>

<div class="safe-top mx-auto min-h-screen max-w-2xl pb-32">
	<StreamNav />

	<div class="px-[22px]">
		{#if groups.length === 0}
			<p class="pt-24 text-center text-[0.94rem]" style="color: var(--color-ink-muted);">
				Nothing yet. Write something — you can sort it out later.
			</p>
		{:else}
			{#each groups as group (group.key)}
				<DayHeading
					label={group.label}
					toggleable={!group.showTimes}
					expanded={revealed.includes(group.key)}
					ontoggle={() => toggleDay(group.key)}
				/>
				{#each group.notes as note (note.id)}
					<Entry {note} showTime={group.showTimes || revealed.includes(group.key)} />
				{/each}
			{/each}
		{/if}
	</div>
</div>

<Composer recentTags={data.recentTags} />
