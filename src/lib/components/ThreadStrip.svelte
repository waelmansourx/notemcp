<script lang="ts">
	import type { ThreadStub } from '$lib/types';

	let {
		threads,
		onSelect,
		label = 'Continue'
	}: { threads: ThreadStub[]; onSelect: (thread: ThreadStub) => void; label?: string } = $props();
</script>

<!--
	Where this thought goes, offered before you write it — wherever you're
	capturing from. One tap turns the draft into an addition; you never see or
	reload the note you're adding to. Shared by the in-app composer and the
	share-sheet capture flow so continuing a thread feels the same from
	either one.
-->
<div class="mb-2.5 flex shrink-0 items-center gap-2">
	<span
		class="shrink-0 text-[0.62rem] font-extrabold tracking-[0.13em] uppercase"
		style="color: var(--color-ink-faint);">{label}</span
	>
	<div
		class="flex min-w-0 flex-1 items-stretch gap-1.5 overflow-x-auto"
		style="scrollbar-width: none;"
	>
		{#each threads as thread (thread.id)}
			<button
				type="button"
				class="flex w-[148px] shrink-0 items-center gap-2 rounded-[12px] p-1.5 text-left active:scale-[0.97]"
				style="background: var(--color-surface-2);"
				onclick={() => onSelect(thread)}
			>
				{#if thread.image}
					<img
						src={thread.image}
						alt=""
						loading="lazy"
						class="h-7 w-7 shrink-0 rounded-[8px] object-cover"
						style="background: var(--color-bg);"
					/>
				{:else}
					<span
						class="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[0.68rem] font-extrabold"
						style="background: var(--color-accent-soft); color: var(--color-accent);"
						aria-hidden="true">{thread.label.slice(0, 1).toUpperCase()}</span
					>
				{/if}
				<span
					class="line-clamp-2 min-w-0 flex-1 text-[0.71rem] leading-[1.22] font-semibold tracking-[-0.01em]"
					>{thread.label}</span
				>
			</button>
		{/each}
	</div>
</div>
