<script lang="ts">
	import type { Tag } from '$lib/types';
	import { tagLeaf, tagParent } from '$lib/tags';

	let { tag, size = 'sm', href }: { tag: Tag; size?: 'sm' | 'lg'; href?: string } = $props();

	let cls = $derived(size === 'lg' ? 'tag tag-lg' : 'tag');

	/** A path tag is drawn in two tones: the namespace in its own colour, the
	 *  leaf in the accent every tag has. The leaf is the thing you actually
	 *  chose — "#notemcp/bug" is a bug first and a notemcp thing second — so
	 *  it keeps the emphasis while the namespace stays legible beside it. */
	let parent = $derived(tagParent(tag.name));
</script>

{#snippet body()}
	{#if parent}
		<span class="tag-path">#{parent}/</span>{tagLeaf(tag.name)}
	{:else}
		#{tag.name}
	{/if}
{/snippet}

{#if href}
	<a {href} class={cls}>{@render body()}</a>
{:else}
	<span class={cls}>{@render body()}</span>
{/if}
