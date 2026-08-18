<script lang="ts">
	import type { FormatAction } from '$lib/editor/markdown-live';

	let { onaction }: { onaction: (action: FormatAction) => void } = $props();

	const BUTTONS: { action: FormatAction; label: string }[] = [
		{ action: 'task', label: 'Checklist item' },
		{ action: 'bullet', label: 'Bullet list' },
		{ action: 'heading', label: 'Heading' },
		{ action: 'bold', label: 'Bold' },
		{ action: 'link', label: 'Link' }
	];
</script>

<!--
	mousedown is swallowed so the tap never pulls focus out of the editor:
	the caret stays put, the on-screen keyboard stays up, and the command
	applies where the user was actually typing.
-->
<div
	class="flex items-center gap-1 overflow-x-auto"
	onmousedown={(e) => e.preventDefault()}
	role="toolbar"
	tabindex="-1"
	aria-label="Formatting"
>
	{#each BUTTONS as { action, label } (action)}
		<button
			type="button"
			aria-label={label}
			onclick={() => onaction(action)}
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] active:scale-95"
			style="color: var(--color-ink-muted);"
		>
			{#if action === 'task'}
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.9"
					stroke-linecap="round"
					stroke-linejoin="round"
					><rect x="3" y="3" width="18" height="18" rx="5" /><path d="m8 12 2.5 2.5L16 9" /></svg
				>
			{:else if action === 'bullet'}
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.9"
					stroke-linecap="round"
					><path d="M9 6h12M9 12h12M9 18h12" /><circle
						cx="4"
						cy="6"
						r="1.4"
						fill="currentColor"
					/><circle cx="4" cy="12" r="1.4" fill="currentColor" /><circle
						cx="4"
						cy="18"
						r="1.4"
						fill="currentColor"
					/></svg
				>
			{:else if action === 'heading'}
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.1"
					stroke-linecap="round"><path d="M5 5v14M15 5v14M5 12h10" /></svg
				>
			{:else if action === 'bold'}
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.1"
					stroke-linecap="round"
					stroke-linejoin="round"
					><path d="M7 5h6.5a3.5 3.5 0 0 1 0 7H7zM7 12h7.5a3.5 3.5 0 0 1 0 7H7z" /></svg
				>
			{:else}
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.9"
					stroke-linecap="round"
					stroke-linejoin="round"
					><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path
						d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19"
					/></svg
				>
			{/if}
		</button>
	{/each}
</div>
