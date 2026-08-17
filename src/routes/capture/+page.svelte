<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { hostname } from '$lib/dates';
	import { QUICK_TAGS } from '$lib/types';
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	const params = page.url.searchParams;
	const rawTitle = params.get('title') ?? '';
	const rawText = params.get('text') ?? '';
	const rawUrl = params.get('url') ?? '';

	const urlRegex = /https?:\/\/\S+/i;
	const foundUrl = rawUrl || rawText.match(urlRegex)?.[0] || rawTitle.match(urlRegex)?.[0] || '';
	const sourceUrl = foundUrl || null;
	const leftoverText = rawText.replace(urlRegex, '').trim();
	const previewTitle = rawTitle || leftoverText || (sourceUrl ? hostname(sourceUrl) : 'Shared item');
	const previewSubtext = leftoverText && leftoverText !== previewTitle ? leftoverText : '';

	let caption = $state('');
	let saving = $state(false);
	let savedNoteId = $state<string | null>(null);
	let showToast = $state(false);
	let toastLabel = $state('');
	let dismissed = $state(false);
	let navTimer: ReturnType<typeof setTimeout>;

	function dismiss() {
		dismissed = true;
		setTimeout(() => goto('/'), 180);
	}

	async function saveWith(tagNames: string[], label: string) {
		if (saving) return;
		saving = true;
		try {
			const res = await fetch('/api/notes', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title: previewTitle,
					content_markdown: caption,
					source_url: sourceUrl,
					source_type: sourceUrl ? 'share' : null,
					tagNames
				})
			});
			const note = await res.json();
			savedNoteId = note.id;
			toastLabel = label;
			showToast = true;
			navTimer = setTimeout(dismiss, 1400);
		} finally {
			saving = false;
		}
	}

	function openInEditor() {
		const q = new URLSearchParams();
		if (previewTitle) q.set('title', previewTitle);
		if (caption || leftoverText) q.set('content', caption || leftoverText);
		if (sourceUrl) q.set('source_url', sourceUrl);
		goto(`/note/new?${q.toString()}`);
	}

	async function undo() {
		clearTimeout(navTimer);
		showToast = false;
		if (savedNoteId) {
			const id = savedNoteId;
			savedNoteId = null;
			await fetch(`/api/notes/${id}?hard=1`, { method: 'DELETE' });
		}
	}
</script>

<svelte:head>
	<title>Save to NoteMCP</title>
</svelte:head>

{#if !dismissed}
	<div
		class="fixed inset-0 z-40 flex flex-col justify-end"
		style="background: rgba(10, 10, 8, 0.5);"
		transition:fade={{ duration: 200 }}
		onclick={dismiss}
		role="presentation"
	>
		<div
			class="safe-bottom flex max-h-[90vh] flex-col rounded-t-[28px] px-4 pt-2.5"
			style="background: var(--color-bg); box-shadow: 0 -8px 30px rgba(0,0,0,0.18);"
			transition:fly={{ y: 420, duration: 320, easing: quintOut }}
			onclick={(e) => e.stopPropagation()}
			role="presentation"
		>
			<div class="mx-auto mb-2 h-1.25 w-9 shrink-0 rounded-full" style="background: var(--color-border);"
			></div>

			<div class="flex shrink-0 items-center justify-between pb-1">
				<span class="text-xs font-medium" style="color: var(--color-ink-faint);">Save to NoteMCP</span>
				<button
					onclick={dismiss}
					aria-label="Close"
					class="flex h-8 w-8 items-center justify-center rounded-full"
					style="color: var(--color-ink-muted);"
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
						><path d="M18 6 6 18M6 6l12 12" /></svg
					>
				</button>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto pb-1">
				<div
					class="mt-1 mb-4 rounded-[var(--radius-lg)] p-4"
					style="background: var(--color-surface); border: 1px solid var(--color-border);"
				>
					{#if sourceUrl}
						<span
							class="mb-1.5 inline-block rounded-full px-2 py-0.5 text-[0.7rem]"
							style="background: var(--color-surface-2); color: var(--color-ink-muted);"
						>
							{hostname(sourceUrl)}
						</span>
					{/if}
					<p class="line-clamp-3 text-[0.95rem] leading-snug font-medium">{previewTitle}</p>
					{#if previewSubtext}
						<p class="mt-1 line-clamp-2 text-sm" style="color: var(--color-ink-muted);">{previewSubtext}</p>
					{/if}
				</div>

				<textarea
					bind:value={caption}
					placeholder="Add a thought…"
					rows="2"
					class="w-full resize-none rounded-[var(--radius-lg)] px-4 py-3.5 text-[0.95rem] outline-none"
					style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-ink);"
				></textarea>
			</div>

			<div class="shrink-0 pb-4">
				<div class="grid grid-cols-3 gap-2.5">
					{#each QUICK_TAGS as tag (tag)}
						<button
							onclick={() => saveWith([tag], `Saved · #${tag}`)}
							disabled={saving}
							class="flex aspect-square flex-col items-center justify-center gap-1 rounded-[var(--radius-lg)] text-sm font-medium disabled:opacity-60"
							style="background: var(--color-accent-soft); color: var(--color-accent);"
						>
							#{tag}
						</button>
					{/each}
					<button
						onclick={openInEditor}
						class="flex aspect-square flex-col items-center justify-center gap-1 rounded-[var(--radius-lg)] text-sm font-medium"
						style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-ink-muted);"
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
							><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></svg
						>
						Open
					</button>
				</div>

				<button
					onclick={() => saveWith([], 'Saved to Inbox')}
					disabled={saving}
					class="mt-3 w-full rounded-[var(--radius-md)] py-4 text-base font-medium disabled:opacity-60"
					style="background: var(--color-accent); color: var(--color-accent-ink);"
				>
					Just save
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showToast}
	<div
		class="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
		style="padding-bottom: env(safe-area-inset-bottom);"
		transition:fly={{ y: 20, duration: 200 }}
	>
		<div
			class="flex items-center gap-3 rounded-full px-5 py-3 text-sm font-medium shadow-lg"
			style="background: var(--color-ink); color: var(--color-bg);"
		>
			<span>{toastLabel}</span>
			<button onclick={undo} class="font-semibold underline underline-offset-2">Undo</button>
		</div>
	</div>
{/if}
