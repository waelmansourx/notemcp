<script lang="ts">
	import Entry from '$lib/components/Entry.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import DayHeading from '$lib/components/DayHeading.svelte';
	import TagChip from '$lib/components/TagChip.svelte';
	import { groupByDay, relativeTime } from '$lib/dates';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let pinned = $derived(data.notes.filter((n) => n.pinned));
	let rest = $derived(data.notes.filter((n) => !n.pinned));
	let groups = $derived(groupByDay(rest));

	let revealed = $state<number[]>([]);
	function toggleDay(key: number) {
		revealed = revealed.includes(key) ? revealed.filter((k) => k !== key) : [...revealed, key];
	}
</script>

<svelte:head><title>#{data.tag.name} · NoteMCP</title></svelte:head>

<div class="safe-top mx-auto min-h-screen max-w-2xl pb-32">
	<header class="flex items-center gap-3 px-[22px] pt-1.5 pb-2">
		<a
			href="/tags"
			aria-label="Back"
			class="grid h-[33px] w-[33px] shrink-0 place-items-center rounded-[0.56rem]"
			style="background: var(--color-surface-2); color: var(--color-ink);"
		>
			<svg
				width="15"
				height="15"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"
				stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg
			>
		</a>
		<div>
			<TagChip tag={data.tag} size="lg" />
			{#if data.notes.length > 0}
				<p class="mt-1 pl-1 text-[0.75rem]" style="color: var(--color-ink-faint);">
					last thought {relativeTime(data.notes[0].created_at)}
				</p>
			{/if}
		</div>
	</header>

	<div class="px-[22px]">
		{#each pinned as note (note.id)}
			<div class="border-b py-3.5" style="border-color: var(--color-border);">
				<p
					class="mb-1.5 text-[0.66rem] font-bold tracking-[0.11em] uppercase"
					style="color: var(--color-accent);"
				>
					Pinned
				</p>
				<Entry {note} showTime={false} />
			</div>
		{/each}

		{#if data.notes.length === 0}
			<p class="pt-20 text-center text-[0.94rem]" style="color: var(--color-ink-muted);">
				Nothing tagged #{data.tag.name} yet.
			</p>
		{/if}

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
	</div>
</div>

<Composer contextTag={data.tag.name} />
