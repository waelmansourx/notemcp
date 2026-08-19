<script lang="ts">
	import type { Tag } from '$lib/types';
	import { tagDisplay } from '$lib/tags';

	let { tag, size = 'sm', href }: { tag: Tag; size?: 'sm' | 'lg'; href?: string } = $props();

	let cls = $derived(size === 'lg' ? 'tag tag-lg' : 'tag');
</script>

{#if href}
	<a {href} class={cls}>#{tagDisplay(tag.name)}</a>
{:else}
	<span class={cls}>#{tagDisplay(tag.name)}</span>
{/if}
