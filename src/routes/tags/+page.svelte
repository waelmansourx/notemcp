<script lang="ts">
	import StreamNav from '$lib/components/StreamNav.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import TagGroup from '$lib/components/TagGroup.svelte';
	import { tagLeaf } from '$lib/tags';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let tagCount = $derived(data.sections.reduce((n, s) => n + s.groups.length, 0));
</script>

<svelte:head><title>Tags · NoteMCP</title></svelte:head>

<div class="safe-top mx-auto min-h-screen max-w-2xl pb-36">
	<StreamNav subtitle={tagCount > 0 ? `${tagCount} ${tagCount === 1 ? 'tag' : 'tags'} in use` : ''} />

	<div class="px-[22px] pt-2">
		{#if data.sections.length === 0}
			<p class="pt-24 text-center text-[0.94rem]" style="color: var(--color-ink-muted);">
				No tags yet. Add one while you're writing and it'll show up here.
			</p>
		{/if}

		<!-- A namespace like "features/composer" is folded into each card's own
		     label instead of a heading of its own — sections run one after
		     another with no divider between them. -->
		{#each data.sections as section (section.key)}
			{#each section.groups as group (group.tag.id)}
				<TagGroup
					tag={group.tag}
					count={group.count}
					notes={group.notes}
					label={section.namespace ? tagLeaf(group.tag.name) : undefined}
				/>
			{/each}
		{/each}

		{#if data.sections.length > 0}
			<p class="pt-4 text-[0.82rem] leading-relaxed" style="color: var(--color-ink-muted);">
				Tags help related thoughts find each other. Tap one to filter the stream. Name one
				"area/topic" to group it with its neighbors.
			</p>
		{/if}
	</div>
</div>

<Composer />
