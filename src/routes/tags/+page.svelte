<script lang="ts">
	import StreamNav from '$lib/components/StreamNav.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import TagGroup from '$lib/components/TagGroup.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Tags · NoteMCP</title></svelte:head>

<div class="safe-top mx-auto min-h-screen max-w-2xl pb-36">
	<StreamNav
		subtitle={data.groups.length > 0
			? `${data.groups.length} ${data.groups.length === 1 ? 'tag' : 'tags'} in use`
			: ''}
	/>

	<div class="px-[22px] pt-2">
		{#if data.groups.length === 0}
			<p class="pt-24 text-center text-[0.94rem]" style="color: var(--color-ink-muted);">
				No tags yet. Add one while you're writing and it'll show up here.
			</p>
		{/if}

		<!-- Each card's header goes to the stream filtered by that tag, rather
		     than to a per-tag page with its own layout: one place where thoughts
		     live, narrowed. -->
		{#each data.groups as group (group.tag.id)}
			<TagGroup tag={group.tag} count={group.count} notes={group.notes} />
		{/each}

		{#if data.groups.length > 0}
			<p class="pt-4 text-[0.82rem] leading-relaxed" style="color: var(--color-ink-muted);">
				Tags help related thoughts find each other. Tap one to filter the stream.
			</p>
		{/if}
	</div>
</div>

<Composer />
