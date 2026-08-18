<script lang="ts">
	let {
		label,
		expanded = false,
		toggleable = false,
		ontoggle
	}: {
		label: string;
		expanded?: boolean;
		toggleable?: boolean;
		ontoggle?: () => void;
	} = $props();
</script>

{#if toggleable}
	<!-- Times are hidden on older days. Tapping the heading is the "show me the
	     metadata" affordance — cheap, reversible, and it costs nothing when
	     nobody uses it. -->
	<button
		type="button"
		class="w-full pt-[22px] pb-0.5 text-left text-[0.66rem] font-bold tracking-[0.11em] uppercase"
		style="color: var(--color-ink-faint);"
		aria-pressed={expanded}
		onclick={ontoggle}
	>
		{label}<span
			class="ml-1.5 font-normal tracking-normal normal-case opacity-0 transition-opacity"
			class:opacity-100={expanded}>times</span
		>
	</button>
{:else}
	<h2
		class="pt-[22px] pb-0.5 text-[0.66rem] font-bold tracking-[0.11em] uppercase"
		style="color: var(--color-ink-faint);"
	>
		{label}
	</h2>
{/if}
