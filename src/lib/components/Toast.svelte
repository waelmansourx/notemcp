<script lang="ts">
	import { toastMessage } from '$lib/toast.svelte';
	import { fly, fade } from 'svelte/transition';

	let message = $derived(toastMessage());
</script>

{#if message}
	<div
		class="safe-bottom pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-[18px]"
	>
		<div
			class="pointer-events-none rounded-full px-4 py-2 text-[0.82rem] font-medium"
			style="background: var(--color-ink); color: var(--color-bg); box-shadow: 0 8px 20px rgba(0,0,0,.18);"
			transition:fly={{ y: 10, duration: 180 }}
		>
			{#key message}
				<span in:fade={{ duration: 140 }}>{message}</span>
			{/key}
		</div>
	</div>
{/if}
