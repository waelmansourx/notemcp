<script lang="ts">
	import { page } from '$app/state';

	let onTags = $derived(page.url.pathname.startsWith('/tags'));
</script>

<header class="mb-1 flex items-center gap-[18px] px-[22px] pt-1.5 pb-3.5">
	<a
		href="/"
		class="text-[1.5rem] leading-tight font-[650] tracking-[-0.025em] transition-colors"
		style={onTags ? 'color: var(--color-ink-faint);' : 'color: var(--color-ink);'}
		aria-current={onTags ? undefined : 'page'}>Thoughts</a
	>
	<a
		href="/tags"
		class="text-[1.5rem] leading-tight font-[650] tracking-[-0.025em] transition-colors"
		style={onTags ? 'color: var(--color-ink);' : 'color: var(--color-ink-faint);'}
		aria-current={onTags ? 'page' : undefined}>Tags</a
	>
	<span class="flex-1"></span>
	<a
		href="/account"
		aria-label="Account"
		class="grid h-8 w-8 place-items-center rounded-full text-[0.75rem] font-bold"
		style="background: var(--color-accent-soft); color: var(--color-accent);">·</a
	>
</header>
