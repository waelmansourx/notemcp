<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { openFilter } from '$lib/filter.svelte';

	let {
		subtitle = '',
		minimal = false
	}: {
		subtitle?: string;
		minimal?: boolean;
	} = $props();

	let onTags = $derived(page.url.pathname.startsWith('/tags'));

	function search() {
		openFilter();
		if (page.url.pathname !== '/') goto('/');
	}
</script>

<header
	class="px-[26px] {minimal ? 'hidden pt-4 pb-2 lg:flex' : 'pt-7 pb-1 lg:flex'} lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:px-0 lg:pt-10 lg:pb-8"
>
	<div class="flex items-center gap-3 lg:grid lg:grid-cols-2 lg:gap-2">
		{#if !minimal}
			<nav class="flex min-w-0 flex-1 items-baseline gap-3.5 lg:col-span-2 lg:flex-col lg:items-start lg:gap-2">
				<a
					href="/"
					class="font-serif italic leading-none transition-colors {onTags
						? 'text-[1.52rem]'
						: 'text-[2.12rem]'}"
					style={onTags ? 'color: #cdc5b6;' : 'color: var(--color-ink);'}
					aria-current={onTags ? undefined : 'page'}
				>
					Thoughts
				</a>
				<a
					href="/tags"
					class="font-serif italic leading-none transition-colors {onTags
						? 'text-[2.12rem]'
						: 'text-[1.52rem]'}"
					style={onTags ? 'color: var(--color-ink);' : 'color: #cdc5b6;'}
					aria-current={onTags ? 'page' : undefined}
				>
					Tags
				</a>
			</nav>

			<button
				type="button"
				aria-label="Search and filter"
				class="hidden h-[38px] w-[38px] shrink-0 place-items-center rounded-full active:scale-95 lg:grid"
				style="background: var(--color-accent-soft); color: var(--color-accent);"
				onclick={search}
			>
				<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="11" cy="11" r="7" />
					<path d="m21 21-4.3-4.3" />
				</svg>
			</button>
		{:else}
			<span class="min-w-0 flex-1"></span>
		{/if}

		<a
			href="/account"
			aria-label="Account"
			class="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full active:scale-95"
			style="background: var(--color-accent-soft); color: var(--color-accent);"
		>
			<svg
				width="15"
				height="15"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<circle cx="12" cy="8.5" r="3.4" />
				<path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
			</svg>
		</a>
	</div>

	{#if !minimal && subtitle}
		<p
			class="mt-3 hidden text-[0.72rem] leading-[1.4] font-medium tracking-[-0.01em] lg:block"
			style="color: var(--color-ink-faint);"
		>
			{subtitle}
		</p>
	{/if}
</header>
