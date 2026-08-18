<script lang="ts">
	import { page } from '$app/state';

	let onTags = $derived(page.url.pathname.startsWith('/tags'));
</script>

<!--
	Quieter than it was. Two 1.5rem bold words sitting above the stream read as
	a masthead, and competed with the notes for the top of the page — the app
	was announcing itself on a screen you open forty times a day. The sections
	are still there and still one tap apart; they're just sized like navigation
	rather than like a headline, with the active one carried by an accent rule
	instead of by sheer weight.
-->
<header class="mb-0.5 flex items-baseline gap-5 px-[22px] pt-2 pb-3">
	<a
		href="/"
		class="relative pb-1 text-[1.06rem] leading-none font-[620] tracking-[-0.02em] transition-colors"
		style={onTags ? 'color: var(--color-ink-faint);' : 'color: var(--color-ink);'}
		aria-current={onTags ? undefined : 'page'}
	>
		Thoughts
		{#if !onTags}
			<span
				class="absolute inset-x-0 -bottom-0.5 h-[2px] rounded-full"
				style="background: var(--color-accent);"
			></span>
		{/if}
	</a>

	<a
		href="/tags"
		class="relative pb-1 text-[1.06rem] leading-none font-[620] tracking-[-0.02em] transition-colors"
		style={onTags ? 'color: var(--color-ink);' : 'color: var(--color-ink-faint);'}
		aria-current={onTags ? 'page' : undefined}
	>
		Tags
		{#if onTags}
			<span
				class="absolute inset-x-0 -bottom-0.5 h-[2px] rounded-full"
				style="background: var(--color-accent);"
			></span>
		{/if}
	</a>

	<span class="flex-1"></span>

	<a
		href="/account"
		aria-label="Account"
		class="grid h-[26px] w-[26px] shrink-0 place-items-center self-center rounded-full"
		style="border: 1px solid var(--color-border); color: var(--color-ink-muted);"
	>
		<svg
			width="13"
			height="13"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.9"
			stroke-linecap="round"
			stroke-linejoin="round"
			><circle cx="12" cy="8.5" r="3.5" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg
		>
	</a>
</header>
