<script lang="ts">
	let { label }: { label: string } = $props();
</script>

<!-- A centered pill, the way a chat app marks the start of a new day — the
     shape reads as "time moved on" rather than "new section of the page,"
     which is the distinction a stream of thoughts actually needs. -->
<div class="flex justify-center pt-[22px] pb-2">
	<h2
		class="rounded-full px-3.5 py-[5px] text-[0.72rem] font-semibold tracking-[-0.005em]"
		style="background: var(--color-surface-2); color: var(--color-ink-muted);"
	>
		{label}
	</h2>
</div>
