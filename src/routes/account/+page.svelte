<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
</script>

<svelte:head>
	<title>Account · NoteMCP</title>
</svelte:head>

<div class="safe-top safe-bottom mx-auto min-h-screen max-w-sm px-6 pt-6">
	<button
		onclick={() => goto('/')}
		aria-label="Back"
		class="mb-4 flex h-9 w-9 items-center justify-center rounded-full"
		style="color: var(--color-ink-muted);"
	>
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.2"
			stroke-linecap="round"
			stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg
		>
	</button>

	<h1 class="mb-1 text-xl font-semibold tracking-tight">Account</h1>
	<p class="mb-8 text-sm" style="color: var(--color-ink-muted);">{data.email}</p>

	<h2 class="mb-3 text-sm font-medium">Set a password</h2>
	<p class="mb-3 text-sm" style="color: var(--color-ink-muted);">
		Sign in faster next time instead of waiting on a magic-link email.
	</p>

	{#if form?.saved}
		<p class="mb-3 text-sm font-medium" style="color: var(--color-accent);">Password saved.</p>
	{/if}

	<form
		method="POST"
		action="?/setPassword"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				submitting = false;
				await update({ reset: true });
			};
		}}
		class="flex flex-col gap-3"
	>
		<input
			type="password"
			name="password"
			required
			minlength="6"
			autocomplete="new-password"
			placeholder="New password"
			class="w-full rounded-[var(--radius-md)] px-4 py-3.5 text-base outline-none"
			style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-ink);"
		/>
		{#if form?.error}
			<p class="px-1 text-sm" style="color: var(--color-danger);">{form.error}</p>
		{/if}
		<button
			type="submit"
			disabled={submitting}
			class="w-full rounded-[var(--radius-md)] py-3.5 text-base font-medium disabled:opacity-60"
			style="background: var(--color-accent); color: var(--color-accent-ink);"
		>
			{submitting ? 'Saving…' : 'Save password'}
		</button>
	</form>

	<form method="POST" action="/auth/signout" class="mt-10">
		<button
			type="submit"
			class="w-full rounded-[var(--radius-md)] py-3.5 text-base font-medium"
			style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-ink-muted);"
		>
			Sign out
		</button>
	</form>
</div>
