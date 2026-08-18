<script lang="ts">
	import StreamNav from '$lib/components/StreamNav.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import TagChip from '$lib/components/TagChip.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Tags · NoteMCP</title></svelte:head>

<div class="safe-top mx-auto min-h-screen max-w-2xl pb-32">
	<StreamNav />

	<div class="px-[22px]">
		{#each data.tags as summary (summary.tag.id)}
			<a
				href={`/tags/${encodeURIComponent(summary.tag.name)}`}
				class="block border-b py-4 active:opacity-65"
				style="border-color: var(--color-border);"
			>
				<TagChip tag={summary.tag} size="lg" />
				{#if summary.last}
					<p
						class="mt-2 line-clamp-1 text-[0.88rem] leading-[1.38] tracking-[-0.011em]"
						style="color: var(--color-ink-muted);"
					>
						{summary.last}
					</p>
				{/if}
				{#if summary.thumbs.length > 0}
					<div class="mt-2.5 flex gap-1.5">
						{#each summary.thumbs as thumb (thumb)}
							<img
								src={thumb}
								alt=""
								loading="lazy"
								class="h-[34px] w-[34px] rounded-[var(--radius-sm)] object-cover"
								style="background: var(--color-surface-2);"
							/>
						{/each}
					</div>
				{/if}
			</a>
		{/each}

		<p class="pt-6 text-[0.82rem] leading-relaxed" style="color: var(--color-ink-muted);">
			Tags help related thoughts find each other.
		</p>
	</div>
</div>

<Composer />
