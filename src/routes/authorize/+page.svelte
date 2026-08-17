<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
</script>

<svelte:head>
	<title>Authorize · NoteMCP</title>
</svelte:head>

<div class="safe-top safe-bottom flex min-h-screen flex-col items-center justify-center px-6">
	<div class="w-full max-w-sm">
		<div class="mb-8 flex flex-col items-center gap-3 text-center">
			<div
				class="flex h-14 w-14 items-center justify-center rounded-[1.1rem]"
				style="background: var(--color-accent);"
			>
				<span class="text-xl font-semibold tracking-tight" style="color: var(--color-accent-ink);"
					>n</span
				>
			</div>
			<h1 class="text-2xl font-semibold tracking-tight">NoteMCP</h1>
		</div>

		{#if data.error || form?.error}
			<div
				class="rounded-[var(--radius-lg)] p-5 text-center"
				style="background: var(--color-surface); border: 1px solid var(--color-border);"
			>
				<p class="font-medium" style="color: var(--color-danger);">Can't continue</p>
				<p class="mt-1 text-sm" style="color: var(--color-ink-muted);">
					{data.error ?? form?.error}
				</p>
			</div>
		{:else if data.params}
			<div
				class="rounded-[var(--radius-lg)] p-5"
				style="background: var(--color-surface); border: 1px solid var(--color-border);"
			>
				<p class="text-center text-[0.95rem] leading-relaxed">
					<span class="font-medium">{data.clientName}</span> wants to read and write your notes.
				</p>

				<div class="mt-5 flex flex-col gap-2.5">
					<form method="POST" action="?/approve" use:enhance={() => {
						submitting = true;
						return async ({ result }) => {
							if (result.type !== 'redirect') submitting = false;
						};
					}}>
						<input type="hidden" name="client_id" value={data.params.client_id} />
						<input type="hidden" name="redirect_uri" value={data.params.redirect_uri} />
						<input type="hidden" name="code_challenge" value={data.params.code_challenge} />
						<input
							type="hidden"
							name="code_challenge_method"
							value={data.params.code_challenge_method}
						/>
						<input type="hidden" name="state" value={data.params.state} />
						<button
							type="submit"
							disabled={submitting}
							class="w-full rounded-[var(--radius-md)] py-3.5 text-base font-medium disabled:opacity-60"
							style="background: var(--color-accent); color: var(--color-accent-ink);"
						>
							{submitting ? 'Connecting…' : 'Allow'}
						</button>
					</form>

					<form method="POST" action="?/deny">
						<input type="hidden" name="redirect_uri" value={data.params.redirect_uri} />
						<input type="hidden" name="state" value={data.params.state} />
						<button
							type="submit"
							disabled={submitting}
							class="w-full rounded-[var(--radius-md)] py-3.5 text-base font-medium disabled:opacity-60"
							style="background: var(--color-surface-2); color: var(--color-ink-muted);"
						>
							Cancel
						</button>
					</form>
				</div>
			</div>
		{/if}
	</div>
</div>
