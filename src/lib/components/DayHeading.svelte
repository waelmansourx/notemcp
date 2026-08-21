<script lang="ts">
	let { label }: { label: string } = $props();
</script>

<!-- position: sticky with no scroll container of its own is the standard
     pure-CSS trick for date dividers: every heading pins to the same top
     offset, so as the page scrolls the current one stays put until the next
     heading's box reaches the top and physically pushes it out — no scroll
     listeners, no JS state, so there's nothing to end up invisible. -->
<div
	class="sticky top-0 z-10 flex justify-start pt-[18px] pb-2"
	style="background: var(--color-bg);"
>
	<h2
		class="py-1.5 text-[0.72rem] font-bold tracking-[0.07em] uppercase"
		style="color: var(--color-ink-muted);"
	>
		{label}
	</h2>
</div>
