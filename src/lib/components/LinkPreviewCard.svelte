<script lang="ts">
	import { hostname } from '$lib/dates';
	import type { LinkPreview } from '$lib/composer/link-preview.svelte';

	let {
		preview,
		mode = 'card',
		fallbackTitle = '',
		fallbackDescription = '',
		removable = true,
		onremove = () => preview.clear(),
		class: className = ''
	}: {
		preview: LinkPreview;
		mode?: 'chip' | 'composer' | 'card' | 'capture';
		fallbackTitle?: string;
		fallbackDescription?: string;
		removable?: boolean;
		onremove?: () => void;
		class?: string;
	} = $props();

	let title = $derived(
		preview.title || fallbackTitle || (preview.url ? hostname(preview.url) : '')
	);
	let description = $derived(preview.description || fallbackDescription);
</script>

{#if preview.url && mode === 'chip'}
	<div
		class="flex w-fit items-center rounded-full {className}"
		style="background: var(--color-surface-2);"
	>
		<a
			href={preview.url}
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex items-center gap-1.5 py-1.5 pr-1 pl-3 text-xs"
			style="color: var(--color-ink-muted);"
		>
			<span aria-hidden="true">↗</span>
			{preview.loading ? 'Fetching preview…' : hostname(preview.url)}
		</a>
		{#if removable}
			<button
				type="button"
				aria-label="Remove link preview"
				class="grid h-7 w-7 place-items-center rounded-full text-xs"
				style="color: var(--color-ink-faint);"
				onclick={onremove}>✕</button
			>
		{/if}
	</div>
{:else if mode === 'capture' && (preview.url || fallbackTitle)}
	<div
		class="flex items-start gap-3 border-b pb-3 {className}"
		style="border-color: var(--color-border);"
	>
		{#if preview.image}
			<img
				src={preview.image}
				alt=""
				class="h-[52px] w-[52px] shrink-0 rounded-[13px] object-cover"
				style="background: var(--color-surface);"
			/>
		{/if}
		<div class="min-w-0 flex-1">
			{#if preview.url}
				<p
					class="mb-0.5 truncate text-[0.68rem] font-extrabold tracking-[0.04em] uppercase"
					style="color: var(--color-ink-faint);"
				>
					{hostname(preview.url)}
				</p>
			{/if}
			<p class="line-clamp-2 text-[0.88rem] leading-[1.3] font-semibold tracking-[-0.01em]">
				{title}
			</p>
			{#if description}
				<p class="mt-0.5 line-clamp-1 text-[0.78rem]" style="color: var(--color-ink-muted);">
					{description}
				</p>
			{:else if preview.loading}
				<div
					class="mt-1.5 h-2 w-2/3 animate-pulse rounded-full"
					style="background: var(--color-surface);"
				></div>
			{/if}
		</div>
		{#if removable && preview.url}
			<button
				type="button"
				aria-label="Remove link preview"
				class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs"
				style="color: var(--color-ink-faint);"
				onclick={onremove}>✕</button
			>
		{/if}
	</div>
{:else if mode === 'composer' && preview.url}
	<div
		class="flex min-w-0 items-center gap-2 rounded-[var(--radius-lg)] p-2 {className}"
		style="background: var(--color-surface-2);"
	>
		{#if preview.image}
			<img src={preview.image} alt="" class="h-9 w-9 shrink-0 rounded-lg object-cover" />
		{/if}
		<a
			href={preview.url}
			target="_blank"
			rel="noopener noreferrer"
			class="min-w-0 flex-1 truncate text-xs font-semibold"
			style="color: var(--color-ink-muted);"
		>
			{preview.loading ? 'Fetching preview…' : preview.title || hostname(preview.url)}
		</a>
		{#if removable}
			<button
				type="button"
				aria-label="Remove link preview"
				class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs"
				style="color: var(--color-ink-faint);"
				onclick={onremove}>✕</button
			>
		{/if}
	</div>
{:else if mode === 'card' && preview.url}
	<div class={className}>
		<div
			class="mb-3 flex w-fit items-center rounded-full"
			style="background: var(--color-surface-2);"
		>
			<a
				href={preview.url}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center gap-1.5 py-1.5 pr-1 pl-3 text-xs"
				style="color: var(--color-ink-muted);"
			>
				<span aria-hidden="true">↗</span>
				{preview.loading ? 'Fetching preview…' : hostname(preview.url)}
			</a>
			{#if removable}
				<button
					type="button"
					aria-label="Remove link preview"
					class="grid h-7 w-7 place-items-center rounded-full text-xs"
					style="color: var(--color-ink-faint);"
					onclick={onremove}>✕</button
				>
			{/if}
		</div>
		{#if preview.image || preview.title || preview.description}
			<a
				href={preview.url}
				target="_blank"
				rel="noopener noreferrer"
				class="flex gap-3 rounded-[var(--radius-lg)] p-3"
				style="background: var(--color-surface-2);"
			>
				{#if preview.image}
					<img
						src={preview.image}
						alt=""
						class="h-16 w-16 shrink-0 rounded-[var(--radius-sm)] object-cover"
					/>
				{/if}
				<div class="min-w-0 flex-1">
					{#if preview.title}<p class="truncate text-sm font-medium">{preview.title}</p>{/if}
					{#if preview.description}<p
							class="mt-0.5 line-clamp-2 text-xs leading-snug"
							style="color: var(--color-ink-muted);"
						>
							{preview.description}
						</p>{/if}
				</div>
			</a>
		{/if}
	</div>
{/if}
