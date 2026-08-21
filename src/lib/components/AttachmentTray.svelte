<script lang="ts">
	import type { ImageAttachments } from '$lib/composer/image-attachments.svelte';

	let {
		attachments,
		size = 'compact',
		class: className = ''
	}: {
		attachments: ImageAttachments;
		size?: 'compact' | 'large';
		class?: string;
	} = $props();

	let imageClass = $derived(
		size === 'large' ? 'h-32 w-32 rounded-[16px]' : 'h-20 w-20 rounded-[var(--radius-lg)]'
	);
</script>

{#if attachments.items.length > 0}
	<div class="flex gap-2 overflow-x-auto pt-1 pr-1 {className}">
		{#each attachments.items as image (image.key)}
			<div class="relative shrink-0">
				{#if image.dataUrl}
					<img
						src={image.dataUrl}
						alt=""
						class="{imageClass} object-cover"
						class:opacity-50={image.processing || image.uploadError}
						style="background: var(--color-surface-2);"
					/>
				{:else}
					<div class="{imageClass} animate-pulse" style="background: var(--color-surface-2);"></div>
				{/if}
				{#if image.processing}
					<span
						class="absolute inset-0 grid place-items-center text-[0.68rem] font-bold"
						style="color: var(--color-ink-muted);"
					>
						Compressing
					</span>
				{/if}
				<button
					type="button"
					aria-label="Remove image"
					class="absolute -top-1 -right-1 grid h-7 w-7 place-items-center rounded-full text-xs"
					style="background: var(--color-ink); color: var(--color-bg);"
					onclick={() => attachments.remove(image.key)}
				>
					✕
				</button>
			</div>
		{/each}
	</div>
{/if}

{#if attachments.error || attachments.items.some((image) => image.uploadError)}
	<p class="text-[0.78rem]" style="color: var(--color-danger);">
		{attachments.error ?? "Couldn't upload one or more images — remove them or try again."}
	</p>
{/if}
