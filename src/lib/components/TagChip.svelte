<script lang="ts">
	import type { Tag } from '$lib/types';
	import { tagClass } from '$lib/tags';

	let { tag, size = 'sm', href }: { tag: Tag; size?: 'sm' | 'lg'; href?: string } = $props();
</script>

{#if href}
	<a {href} class={tagClass(tag.color, size)}>#{tag.name}</a>
{:else}
	<span class={tagClass(tag.color, size)}>#{tag.name}</span>
{/if}
