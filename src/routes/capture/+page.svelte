<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { hostname } from '$lib/dates';
	import { QUICK_TAGS } from '$lib/types';
	import { queueNote, removeFromOutbox, syncEntry, type OutboxEntry } from '$lib/outbox';
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
	const fallbackTitle = rawTitle || leftoverText || (sourceUrl ? hostname(sourceUrl) : 'Shared item');
	const fallbackSubtext = leftoverText && leftoverText !== fallbackTitle ? leftoverText : '';

	// Best-effort link preview — fetched in the background and never blocks
	// saving. If it resolves before the user taps something, it replaces the
	// raw shared text with the page's real title.
	let fetchedTitle = $state<string | null>(null);
	let fetchedDescription = $state<string | null>(null);
	let fetchedImage = $state<string | null>(null);
	let previewLoading = $state(false);

	let displayTitle = $derived(fetchedTitle || fallbackTitle);
	let displaySubtext = $derived(fetchedDescription || fallbackSubtext);

	onMount(() => {
		if (!sourceUrl) return;
		previewLoading = true;
		fetch(`/api/link-preview?url=${encodeURIComponent(sourceUrl)}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (!data) return;
				fetchedTitle = data.title ?? null;
				fetchedDescription = data.description ?? null;
				fetchedImage = data.image ?? null;
			})
			.catch(() => {})
			.finally(() => {
				previewLoading = false;
			});
	});

	let caption = $state('');
	let submitted = $state(false);
	let submittedKey = $state<string | null>(null);
	let showToast = $state(false);
	let toastLabel = $state('');
	let dismissed = $state(false);
	let pending = $state<{ entry: OutboxEntry; noteId: string | null } | null>(null);
	let navTimer: ReturnType<typeof setTimeout>;

	// Android launches a share-target navigation as a fresh activity with no
	// prior history, which is precisely the condition browsers require to
	// honor a script-initiated window.close() — so this has a real shot at
	// dropping the user straight back into the app they shared from. If it's
	// not permitted (e.g. testing in a normal browser tab), fall back home.
	function leave() {
		dismissed = true;
		setTimeout(() => {
			window.close();
			setTimeout(() => goto('/'), 250);
		}, 180);
	}

	function saveWith(tagNames: string[], label: string, key: string) {
		if (submitted) return;
		submitted = true;
		submittedKey = key;

		const entry = queueNote({
			title: displayTitle,
			content_markdown: caption,
			source_url: sourceUrl,
			source_type: sourceUrl ? 'share' : null,
			tagNames
		});
		pending = { entry, noteId: null };

		toastLabel = label;
		showToast = true;
		navTimer = setTimeout(leave, 950);

		syncEntry(entry, (id) => {
			if (pending?.entry.client_id === entry.client_id) pending.noteId = id;
		});
	}

	function openInEditor() {
		if (submitted) return;
		const q = new URLSearchParams();
		if (displayTitle) q.set('title', displayTitle);
		if (caption || leftoverText) q.set('content', caption || leftoverText);
		if (sourceUrl) q.set('source_url', sourceUrl);
		goto(`/note/new?${q.toString()}`);
	}

	async function undo() {
		clearTimeout(navTimer);
		showToast = false;
		if (!pending) return;
		removeFromOutbox(pending.entry.client_id);
		if (pending.noteId) {
			await fetch(`/api/notes/${pending.noteId}?hard=1`, { method: 'DELETE', keepalive: true });
		}
		pending = null;
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
		onclick={leave}
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
					onclick={leave}
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
					<div class="flex gap-3">
						{#if fetchedImage}
							<img
								src={fetchedImage}
								alt=""
								class="h-14 w-14 shrink-0 rounded-[var(--radius-sm)] object-cover"
								style="background: var(--color-surface-2);"
							/>
						{/if}
						<div class="min-w-0 flex-1">
							{#if sourceUrl}
								<span
									class="mb-1.5 inline-block rounded-full px-2 py-0.5 text-[0.7rem]"
									style="background: var(--color-surface-2); color: var(--color-ink-muted);"
								>
									{hostname(sourceUrl)}
								</span>
							{/if}
							<p class="line-clamp-3 text-[0.95rem] leading-snug font-medium">{displayTitle}</p>
							{#if displaySubtext}
								<p class="mt-1 line-clamp-2 text-sm" style="color: var(--color-ink-muted);">{displaySubtext}</p>
							{:else if previewLoading}
								<div
									class="mt-1.5 h-2.5 w-2/3 animate-pulse rounded-full"
									style="background: var(--color-surface-2);"
								></div>
							{/if}
						</div>
					</div>
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
						{@const done = submittedKey === tag}
						<button
							onclick={() => saveWith([tag], `Saved · #${tag}`, tag)}
							disabled={submitted}
							class="flex aspect-square flex-col items-center justify-center gap-1 rounded-[var(--radius-lg)] text-sm font-medium transition-colors duration-150 disabled:opacity-100"
							style={done
								? 'background: var(--color-success-soft); color: var(--color-success);'
								: `background: var(--color-accent-soft); color: var(--color-accent); ${submitted ? 'opacity: 0.4;' : ''}`}
						>
							{#if done}
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"
									><path d="M20 6 9 17l-5-5" /></svg
								>
							{:else}
								#{tag}
							{/if}
						</button>
					{/each}
					<button
						onclick={openInEditor}
						disabled={submitted}
						class="flex aspect-square flex-col items-center justify-center gap-1 rounded-[var(--radius-lg)] text-sm font-medium"
						style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-ink-muted); {submitted
							? 'opacity: 0.4;'
							: ''}"
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
							><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></svg
						>
						Open
					</button>
				</div>

				<button
					onclick={() => saveWith([], 'Saved to Inbox', 'inbox')}
					disabled={submitted}
					class="mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] py-4 text-base font-medium transition-colors duration-150"
					style={submittedKey === 'inbox'
						? 'background: var(--color-success-soft); color: var(--color-success);'
						: `background: var(--color-accent); color: var(--color-accent-ink); ${submitted ? 'opacity: 0.4;' : ''}`}
				>
					{#if submittedKey === 'inbox'}
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"
							><path d="M20 6 9 17l-5-5" /></svg
						>
						Saved
					{:else}
						Just save
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showToast}
	<div
		class="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
		style="padding-bottom: env(safe-area-inset-bottom);"
		transition:fly={{ y: 20, duration: 150 }}
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
