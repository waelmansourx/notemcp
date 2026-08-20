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

<!--
	A masthead, then navigation — in that order, and at different sizes.

	Two 17px tabs were carrying both jobs at once, which is why the top of the
	screen read as a settings row rather than as the top of something. The
	section name is now a 33px word with a line of context under it, and the
	tabs sit below it as pills: still one tap apart, but sized like controls
	instead of like a title.
-->
<header class="px-[22px] {minimal ? 'hidden pt-3 pb-2 lg:block' : 'pt-3 pb-1'}">
	<div class="flex items-start gap-3">
		{#if !minimal}
			<div class="min-w-0 flex-1">
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
				class="hidden h-[42px] w-[42px] shrink-0 place-items-center rounded-full active:scale-95 lg:grid"
				style="background: var(--color-surface-2); color: var(--color-ink-2);"
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
			class="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full active:scale-95"
			style="background: var(--color-surface-2); color: var(--color-ink-2);"
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

	<!-- Pulled left by the pill's own padding so the active tab's *text*
	     lines up with the stream underneath it, not the pill's edge. -->
	{#if !minimal}
		<nav class="-mx-[18px] mt-[18px] flex gap-1.5">
			<a
				href="/"
				class="rounded-full px-[18px] py-3 text-[0.95rem] leading-none font-bold tracking-[-0.02em] transition-colors"
				style={onTags
					? 'color: var(--color-ink-faint);'
					: 'background: var(--color-accent-soft); color: var(--color-accent);'}
				aria-current={onTags ? undefined : 'page'}
			>
				Thoughts
			</a>
			<a
				href="/tags"
				class="rounded-full px-[18px] py-3 text-[0.95rem] leading-none font-bold tracking-[-0.02em] transition-colors"
				style={onTags
					? 'background: var(--color-accent-soft); color: var(--color-accent);'
					: 'color: var(--color-ink-faint);'}
				aria-current={onTags ? 'page' : undefined}
			>
				Tags
			</a>
		</nav>
	{/if}
</header>
