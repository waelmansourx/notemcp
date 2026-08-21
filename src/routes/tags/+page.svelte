<script lang="ts">
	import StreamNav from '$lib/components/StreamNav.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import TagGroup from '$lib/components/TagGroup.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let tagCount = $derived(data.nodes.length);

	/** Each level steps in, and stops stepping after the third — past that the
	 *  indent eats the card rather than explaining it. */
	function indent(depth: number): string {
		return `margin-left: ${Math.min(depth, 3) * 14}px;`;
	}
</script>

<svelte:head><title>Tags · NoteMCP</title></svelte:head>

<div
	class="safe-top mx-auto min-h-screen max-w-[72rem] pb-36 lg:grid lg:grid-cols-[13rem_minmax(0,42rem)] lg:justify-center lg:gap-12 lg:px-8"
>
	<StreamNav
		subtitle={tagCount > 0 ? `${tagCount} ${tagCount === 1 ? 'tag' : 'tags'} in use` : ''}
	/>

	<main class="min-w-0 px-[22px] pt-2 lg:px-0">
		{#if data.nodes.length === 0}
			<p class="pt-24 text-center text-[0.94rem]" style="color: var(--color-ink-muted);">
				No tags yet. Add one while you're writing and it'll show up here.
			</p>
		{/if}

		<!--
			The tree the tag paths already imply: `#notemcp/bug/share` puts a card
			at each of the three levels, each one stepped in under the last. A
			parent's card holds everything filed beneath it, so the top of a
			branch is a real place to land rather than a heading you scroll past.
			A card names only its own level — the levels above it are the cards
			directly overhead.
		-->
		{#each data.nodes as node (node.id)}
			<div style={indent(node.depth)}>
				<TagGroup
					tag={{ id: node.id, name: node.name }}
					count={node.count}
					notes={node.notes}
					label={node.depth > 0 ? node.leaf : undefined}
				/>
			</div>
		{/each}

		{#if data.nodes.length > 0}
			<p class="pt-4 text-[0.82rem] leading-relaxed" style="color: var(--color-ink-muted);">
				Tags help related thoughts find each other. Tap one to filter the stream. Name one
				"project/type" — <span class="font-semibold">#notemcp/bug</span> — and it files under
				<span class="font-semibold">#notemcp</span> too, so you never have to add both.
			</p>
		{/if}
	</main>
</div>

<Composer />
