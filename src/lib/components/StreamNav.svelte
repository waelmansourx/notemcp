<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { openFilter } from '$lib/filter.svelte';

	let {
		subtitle = '',
		minimal = false
	}: {
		subtitle?: string;
		/** While search is open, the title/subtitle/tabs would just be
		 *  competing with the filter bar for the same strip of screen — so
		 *  they drop out. On a phone there's no room to spare even for the
		 *  account icon's row, so the whole header steps aside; a desktop
		 *  window can afford to keep that row, which is where the icon
		 *  otherwise lives. */
		minimal?: boolean;
	} = $props();

	let onTags = $derived(page.url.pathname.startsWith('/tags'));
	let title = $derived(onTags ? 'Tags' : 'Thoughts');

	/* On a phone this button lives next to the write bar, where your thumb
	   is. That bar is gone at desktop widths — the composer is a panel — so
	   search moves to the masthead, which is where a pointer looks for it. */
	function search() {
		openFilter();
		if (page.url.pathname !== '/') goto('/');
	}
</script>

<!-- A masthead on a phone and a stable navigation rail on a desktop. The
     links use a single accent rule rather than filled pills, so navigation
     doesn't become another layer of cards around the content. -->
<header
	class="px-[22px] {minimal
		? 'hidden pt-3 pb-2 lg:flex'
		: 'pt-3 pb-1 lg:flex'} lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:px-0 lg:pt-8 lg:pb-8"
>
	<div class="flex items-start gap-3 lg:grid lg:grid-cols-2 lg:gap-2">
		{#if !minimal}
			<div class="min-w-0 flex-1 lg:col-span-2 lg:mb-3">
				<h1 class="text-[2.05rem] leading-[1.04] font-extrabold tracking-[-0.045em]">{title}</h1>
				{#if subtitle}
					<p
						class="mt-2 text-[0.95rem] leading-[1.3] font-medium tracking-[-0.015em]"
						style="color: var(--color-ink-muted);"
					>
						{subtitle}
					</p>
				{/if}
			</div>

			<button
				type="button"
				aria-label="Search and filter"
				class="hidden h-[42px] w-[42px] shrink-0 place-items-center active:scale-95 lg:grid"
				style="color: var(--color-ink-2);"
				onclick={search}
			>
				<svg
					width="19"
					height="19"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg
				>
			</button>
		{:else}
			<span class="min-w-0 flex-1"></span>
		{/if}

		<a
			href="/account"
			aria-label="Account"
			class="grid h-[42px] w-[42px] shrink-0 place-items-center active:scale-95"
			style="color: var(--color-ink-2);"
		>
			<svg
				width="19"
				height="19"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				><circle cx="12" cy="8.5" r="3.5" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg
			>
		</a>
	</div>

	<!-- On desktop the bottom rule turns into a left rail marker. -->
	{#if !minimal}
		<nav class="mt-[18px] flex gap-5 lg:mt-8 lg:flex-col lg:gap-1">
			<a
				href="/"
				class="border-b-2 px-0 py-2 text-[0.95rem] leading-none font-bold tracking-[-0.02em] transition-colors lg:w-full lg:border-b-0 lg:border-l-2 lg:px-3 lg:py-2.5"
				style={onTags
					? 'border-color: transparent; color: var(--color-ink-faint);'
					: 'border-color: var(--color-accent); color: var(--color-accent);'}
				aria-current={onTags ? undefined : 'page'}
			>
				Thoughts
			</a>
			<a
				href="/tags"
				class="border-b-2 px-0 py-2 text-[0.95rem] leading-none font-bold tracking-[-0.02em] transition-colors lg:w-full lg:border-b-0 lg:border-l-2 lg:px-3 lg:py-2.5"
				style={onTags
					? 'border-color: var(--color-accent); color: var(--color-accent);'
					: 'border-color: transparent; color: var(--color-ink-faint);'}
				aria-current={onTags ? 'page' : undefined}
			>
				Tags
			</a>
		</nav>
	{/if}
</header>
