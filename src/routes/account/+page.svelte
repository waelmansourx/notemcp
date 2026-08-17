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

	<h2 class="mt-10 mb-3 text-sm font-medium">Agents (MCP)</h2>
	<p class="mb-4 text-sm" style="color: var(--color-ink-muted);">
		Give a coding agent a token and it can search, read, and write your notes as shared context.
	</p>

	{#if data.tokens.length > 0}
		<div class="mb-4 flex flex-col gap-2">
			{#each data.tokens as t (t.id)}
				<div
					class="flex items-center justify-between rounded-[var(--radius-md)] px-4 py-3"
					style="background: var(--color-surface); border: 1px solid var(--color-border);"
				>
					<div class="min-w-0">
						<p class="truncate text-sm font-medium">{t.name}</p>
						<p class="text-xs" style="color: var(--color-ink-faint);">
							{t.last_used_at ? `Last used ${new Date(t.last_used_at).toLocaleDateString()}` : 'Never used'}
						</p>
					</div>
					<form method="POST" action="?/revokeToken" use:enhance>
						<input type="hidden" name="id" value={t.id} />
						<button type="submit" class="text-xs font-medium" style="color: var(--color-danger);">
							Revoke
						</button>
					</form>
				</div>
			{/each}
		</div>
	{/if}

	{#if form?.created}
		<div
			class="mb-4 rounded-[var(--radius-md)] p-4"
			style="background: var(--color-accent-soft); border: 1px solid var(--color-border);"
		>
			<p class="mb-2 text-sm font-medium">Copy this token now — it won't be shown again.</p>
			<div class="flex items-center gap-2">
				<code
					class="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius-sm)] px-2.5 py-2 text-xs whitespace-nowrap"
					style="background: var(--color-surface); font-family: var(--font-mono);"
				>
					{form.token}
				</code>
				<button
					type="button"
					onclick={() => navigator.clipboard.writeText(String(form.token))}
					class="shrink-0 rounded-[var(--radius-sm)] px-3 py-2 text-xs font-medium"
					style="background: var(--color-accent); color: var(--color-accent-ink);"
				>
					Copy
				</button>
			</div>
		</div>
	{/if}

	<form
		method="POST"
		action="?/generateToken"
		use:enhance={() => {
			return async ({ update }) => {
				await update({ reset: true });
			};
		}}
		class="mb-8 flex gap-2"
	>
		<input
			type="text"
			name="name"
			placeholder="Token name (optional)"
			class="min-w-0 flex-1 rounded-[var(--radius-md)] px-4 py-3 text-sm outline-none"
			style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-ink);"
		/>
		<button
			type="submit"
			class="shrink-0 rounded-[var(--radius-md)] px-4 py-3 text-sm font-medium"
			style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-ink);"
		>
			Generate
		</button>
	</form>

	<details class="mb-10 rounded-[var(--radius-md)] px-4 py-3" style="background: var(--color-surface-2);">
		<summary class="cursor-pointer text-sm font-medium">How to connect</summary>
		<div class="mt-3 flex flex-col gap-3 text-xs" style="color: var(--color-ink-muted);">
			<p>MCP endpoint:</p>
			<code
				class="block overflow-x-auto rounded-[var(--radius-sm)] px-2.5 py-2"
				style="background: var(--color-surface); font-family: var(--font-mono);">{data.mcpUrl}</code
			>
			<p>Claude Code:</p>
			<code
				class="block overflow-x-auto rounded-[var(--radius-sm)] px-2.5 py-2 whitespace-pre"
				style="background: var(--color-surface); font-family: var(--font-mono);"
				>claude mcp add --transport http notemcp {data.mcpUrl} \
  --header "Authorization: Bearer YOUR_TOKEN"</code
			>
		</div>
	</details>

	<form method="POST" action="/auth/signout">
		<button
			type="submit"
			class="w-full rounded-[var(--radius-md)] py-3.5 text-base font-medium"
			style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-ink-muted);"
		>
			Sign out
		</button>
	</form>
</div>
