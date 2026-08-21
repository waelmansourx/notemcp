<script lang="ts">
	let { label }: { label: string } = $props();
</script>

<div
	class="sticky top-0 z-10 flex justify-start pt-[18px] pb-1"
	style="background: color-mix(in srgb, var(--color-bg) 96%, transparent); backdrop-filter: blur(8px);"
>
	<h2
		class="py-1 text-[0.61rem] font-semibold tracking-[0.28em] uppercase"
		style="color: var(--color-accent);"
	>
		{label}
	</h2>
</div>
