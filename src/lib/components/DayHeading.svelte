<script lang="ts">
	let { label }: { label: string } = $props();
</script>

<!-- position: sticky with no scroll container of its own is the standard
     pure-CSS trick for date dividers: every heading pins to the same top
     offset, so as the page scrolls the current one stays put until the next
     heading's box reaches the top and physically pushes it out — no scroll
     listeners, no JS state, so there's nothing to end up invisible. -->
<div class="sticky top-0 z-10 flex justify-center pt-[18px] pb-2">
	<h2
		class="rounded-full px-4 py-1.5 text-[0.78rem] font-semibold shadow-sm"
		style="background: var(--color-surface-2); color: var(--color-ink-muted);"
	>
		{label}
	</h2>
</div>
