<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let mode = $state<'password' | 'signup' | 'magic'>('password');
	let submitting = $state(false);

	let actionPath = $derived(`?/${mode === 'magic' ? 'magic' : mode}`);
</script>

<svelte:head>
	<title>Sign in · NoteMCP</title>
</svelte:head>

<div class="safe-top safe-bottom flex min-h-screen flex-col items-center justify-center px-6">
	<div class="w-full max-w-sm">
		<div class="mb-10 flex flex-col items-center gap-3 text-center">
			<div
				class="flex h-14 w-14 items-center justify-center rounded-[1.1rem]"
				style="background: var(--color-accent);"
			>
				<span class="text-xl font-semibold tracking-tight" style="color: var(--color-accent-ink);"
					>n</span
				>
			</div>
			<h1 class="text-2xl font-semibold tracking-tight">NoteMCP</h1>
			<p class="text-sm leading-relaxed" style="color: var(--color-ink-muted);">
				Capture without deciding.
			</p>
		</div>

		{#if form?.sent}
			<div
				class="rounded-[var(--radius-lg)] p-5 text-center"
				style="background: var(--color-surface); border: 1px solid var(--color-border);"
			>
				<p class="font-medium">Check your email</p>
				<p class="mt-1 text-sm" style="color: var(--color-ink-muted);">
					We sent a sign-in link to {form.email}.
				</p>
			</div>
		{:else if form?.confirmEmail}
			<div
				class="rounded-[var(--radius-lg)] p-5 text-center"
				style="background: var(--color-surface); border: 1px solid var(--color-border);"
			>
				<p class="font-medium">Confirm your email</p>
				<p class="mt-1 text-sm" style="color: var(--color-ink-muted);">
					We sent a confirmation link to {form.email}. Follow it to finish creating your account.
				</p>
			</div>
		{:else}
			{#if mode !== 'magic'}
				<div
					class="mb-5 flex rounded-full p-1"
					style="background: var(--color-surface-2);"
				>
					<button
						type="button"
						onclick={() => (mode = 'password')}
						class="flex-1 rounded-full py-2 text-sm font-medium transition-colors"
						style={mode === 'password'
							? 'background: var(--color-surface); color: var(--color-ink);'
							: 'color: var(--color-ink-muted);'}
					>
						Sign in
					</button>
					<button
						type="button"
						onclick={() => (mode = 'signup')}
						class="flex-1 rounded-full py-2 text-sm font-medium transition-colors"
						style={mode === 'signup'
							? 'background: var(--color-surface); color: var(--color-ink);'
							: 'color: var(--color-ink-muted);'}
					>
						Create account
					</button>
				</div>
			{/if}

			<form
				method="POST"
				action={actionPath}
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						submitting = false;
						await update();
					};
				}}
				class="flex flex-col gap-3"
			>
				<input type="hidden" name="redirectTo" value={data.redirectTo} />
				<input
					type="email"
					name="email"
					required
					autocomplete="email"
					inputmode="email"
					placeholder="you@example.com"
					class="w-full rounded-[var(--radius-md)] px-4 py-3.5 text-base outline-none"
					style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-ink);"
				/>

				{#if mode !== 'magic'}
					<input
						type="password"
						name="password"
						required
						minlength={mode === 'signup' ? 6 : undefined}
						autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
						placeholder="Password"
						class="w-full rounded-[var(--radius-md)] px-4 py-3.5 text-base outline-none"
						style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-ink);"
					/>
				{/if}

				{#if form?.error}
					<p class="px-1 text-sm" style="color: var(--color-danger);">{form.error}</p>
				{/if}

				<button
					type="submit"
					disabled={submitting}
					class="w-full rounded-[var(--radius-md)] py-3.5 text-base font-medium disabled:opacity-60"
					style="background: var(--color-accent); color: var(--color-accent-ink);"
				>
					{#if submitting}
						{mode === 'magic' ? 'Sending…' : mode === 'signup' ? 'Creating…' : 'Signing in…'}
					{:else}
						{mode === 'magic' ? 'Send magic link' : mode === 'signup' ? 'Create account' : 'Sign in'}
					{/if}
				</button>

				<button
					type="button"
					onclick={() => (mode = mode === 'magic' ? 'password' : 'magic')}
					class="mt-1 text-center text-sm"
					style="color: var(--color-ink-muted);"
				>
					{mode === 'magic' ? '← Use a password instead' : 'Use a magic link instead'}
				</button>
			</form>
		{/if}
	</div>
</div>
