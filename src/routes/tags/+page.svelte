<script lang="ts">
	import StreamNav from '$lib/components/StreamNav.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import { snippet } from '$lib/markdown';
	import { relativeTime } from '$lib/dates';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Tags · NoteMCP</title></svelte:head>

<div class="safe-top mx-auto min-h-screen max-w-2xl pb-32">
	<StreamNav />

	<div class="px-[22px]">
		{#if data.tags.length === 0}
			<p class="pt-24 text-center text-[0.94rem]" style="color: var(--color-ink-muted);">
				No tags yet. Add one while you're writing and it'll show up here.
			</p>
		{/if}

		<!-- Each row goes to the stream filtered by that tag, rather than to a
		     separate per-tag page with its own layout: one place where thoughts
		     live, narrowed. -->
		{#each data.tags as summary (summary.tag.id)}
			<a
				href={`/?tag=${encodeURIComponent(summary.tag.name)}`}
				class="flex items-baseline gap-2.5 border-b py-3.5 active:opacity-65"
				style="border-color: var(--color-border);"
			>
				<span class="tag tag-lg shrink-0">#{summary.tag.name}</span>
				<span class="min-w-0 flex-1 truncate text-[0.85rem]" style="color: var(--color-ink-muted);">
					{snippet(summary.last, 90)}
				</span>
				<span class="shrink-0 text-[0.72rem] tabular-nums" style="color: var(--color-ink-faint);">
					{summary.count}
				</span>
			</a>
		{/each}

		{#if data.tags.length > 0}
			<p class="pt-6 text-[0.82rem] leading-relaxed" style="color: var(--color-ink-muted);">
				Tags help related thoughts find each other. Tap one to filter the stream.
			</p>
		{/if}
	</div>
</div>

<Composer />
