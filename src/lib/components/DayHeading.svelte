<script lang="ts">
	let { label }: { label: string } = $props();
</script>

<!-- A left-aligned marker with real space above it, rather than a centred grey
     pill. The pill was a chat-app gesture — it floated in the middle of the
     column and made every day break look like an interruption. This reads as
     the head of a section: quiet, but structural, and it lines up with the
     thoughts it introduces. -->
<h2
	class="pt-[30px] pb-1.5 text-[0.72rem] font-extrabold tracking-[0.14em] uppercase"
	style="color: var(--color-ink-faint);"
>
	{label}
</h2>
