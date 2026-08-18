<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { hostname } from '$lib/dates';
	import { QUICK_TAGS } from '$lib/types';
	import { queueNote, syncEntryNow } from '$lib/outbox';
	import { addPending, removePending } from '$lib/stream.svelte';
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	const SHARE_CACHE = 'notemcp-share-v1';
	const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

	const params = page.url.searchParams;
	const rawTitle = params.get('title') ?? '';
	const rawText = params.get('text') ?? '';
	const rawUrl = params.get('url') ?? '';
	const sharedId = params.get('shared');

	const urlRegex = /https?:\/\/\S+/i;
	const foundUrl = rawUrl || rawText.match(urlRegex)?.[0] || rawTitle.match(urlRegex)?.[0] || '';
	const sourceUrl = foundUrl || null;
	const leftoverText = rawText.replace(urlRegex, '').trim();

	// Best-effort link preview — fetched in the background and never blocks
	// saving. If it resolves before the user taps something, it replaces the
	// raw shared text with the page's real title.
	let fetchedTitle = $state<string | null>(null);
	let fetchedDescription = $state<string | null>(null);
	let fetchedImage = $state<string | null>(null);
	let previewLoading = $state(false);

	// A shared screenshot/photo, pulled out of Cache Storage where the
	// service worker stashed it (see src/service-worker.ts).
	let sharedImageDataUrl = $state<string | null>(null);
	let sharedImageTooLarge = $state(false);
	let sharedImageLoading = $state(!!sharedId);

	let fallbackTitle = $derived(
		rawTitle ||
			leftoverText ||
			(sourceUrl ? hostname(sourceUrl) : sharedId ? 'Shared image' : 'Shared item')
	);
	let fallbackSubtext = $derived(leftoverText && leftoverText !== fallbackTitle ? leftoverText : '');
	let displayTitle = $derived(fetchedTitle || fallbackTitle);
	let displaySubtext = $derived(fetchedDescription || fallbackSubtext);

	onMount(() => {
		if (sourceUrl) {
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
		}

		if (sharedId) {
			(async () => {
				try {
					const cache = await caches.open(SHARE_CACHE);
					const key = `/__share/${sharedId}`;
					const res = await cache.match(key);
					if (!res) return;
					const blob = await res.blob();
					await cache.delete(key);
					if (blob.size > MAX_IMAGE_BYTES) {
						sharedImageTooLarge = true;
						return;
					}
					sharedImageDataUrl = await new Promise<string>((resolve, reject) => {
						const reader = new FileReader();
						reader.onload = () => resolve(reader.result as string);
						reader.onerror = reject;
						reader.readAsDataURL(blob);
					});
				} catch {
					// no image ever arrives — just proceed as a text-only capture
				} finally {
					sharedImageLoading = false;
				}
			})();
		}
	});

	let caption = $state('');
	let submitted = $state(false);
	let submittedKey = $state<string | null>(null);
	let dismissed = $state(false);

	function buildContent(): string {
		const parts: string[] = [];
		if (sharedImageDataUrl) parts.push(`![Shared image](${sharedImageDataUrl})`);
		if (caption.trim()) parts.push(caption.trim());
		return parts.join('\n\n');
	}

	// Android launches a share-target navigation as a fresh activity with no
	// prior history, which is precisely the condition browsers require to
	// honor a script-initiated window.close() — so this has a real shot at
	// dropping the user straight back into the app they shared from. We move
	// to "/" first (replacing this history entry) before trying, so that if
	// the OS kills the process before close() lands, relaunching the app
	// resumes on the home river instead of a dead capture screen.
	async function leave(sending?: Promise<unknown>) {
		await goto('/', { replaceState: true, noScroll: true });
		dismissed = true;
		// Closing the tab aborts anything still in flight, so that — and only
		// that — waits for the upload. The sheet is already gone by then.
		if (sending) await sending.catch(() => {});
		window.close();
	}

	function saveWith(tagNames: string[], key: string) {
		if (submitted) return;
		submitted = true;
		submittedKey = key;

		const entry = queueNote({
			title: displayTitle,
			content_markdown: buildContent(),
			source_url: sourceUrl,
			source_type: sourceUrl || sharedImageDataUrl ? 'share' : null,
			source_title: fetchedTitle,
			source_description: fetchedDescription,
			source_image: fetchedImage,
			tagNames
		});

		// The note is durable in localStorage the moment queueNote() returns,
		// and the server now keys on client_id so a retry can't duplicate it.
		// Nothing about the round trip is worth standing still for: show it in
		// the stream and go. Waiting on the upload here — which is what the
		// image path used to do — is what made saving a shared photo feel like
		// the app had hung.
		addPending(entry);
		leave(
			syncEntryNow(entry).then((noteId) => {
				// Once it's on the server the stream will load it for real, so the
				// local stand-in has done its job.
				if (noteId) removePending(entry.client_id);
			})
		);
	}

	function openInEditor() {
		if (submitted) return;
		const q = new URLSearchParams();
		if (displayTitle) q.set('title', displayTitle);
		const content = buildContent() || caption || leftoverText;
		if (content) q.set('content', content);
		if (sourceUrl) q.set('source_url', sourceUrl);
		if (fetchedTitle) q.set('source_title', fetchedTitle);
		if (fetchedDescription) q.set('source_description', fetchedDescription);
		if (fetchedImage) q.set('source_image', fetchedImage);
		goto(`/note/new?${q.toString()}`);
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
		onclick={() => leave()}
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

			<div class="relative flex shrink-0 items-center justify-center pt-1 pb-3">
				<button
					onclick={() => leave()}
					aria-label="Close"
					class="absolute left-0 flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)]"
					style="background: var(--color-surface); color: var(--color-ink); box-shadow: 0 1px 2px rgba(0,0,0,0.06);"
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
						><path d="M18 6 6 18M6 6l12 12" /></svg
					>
				</button>
				<div class="text-center">
					<p class="text-base font-bold">Quick capture</p>
					<p class="text-xs" style="color: var(--color-ink-faint);">Shared to NoteMCP</p>
				</div>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto pb-1">
				{#if sharedImageLoading}
					<div
						class="mt-1 mb-4 flex h-32 items-center justify-center rounded-[var(--radius-lg)]"
						style="background: var(--color-surface); border: 1px solid var(--color-border);"
					>
						<div class="h-5 w-5 animate-spin rounded-full border-2" style="border-color: var(--color-border); border-top-color: var(--color-accent);"
						></div>
					</div>
				{:else}
					<div
						class="mt-1 mb-4 rounded-[var(--radius-lg)] p-4"
						style="background: var(--color-surface); border: 1px solid var(--color-border);"
					>
						{#if !sharedImageDataUrl}
							<div
								class="mb-3 flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)]"
								style="background: var(--color-accent-soft); color: var(--color-accent);"
							>
								<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
									><path d="M7 17 17 7M8 7h9v9" /></svg
								>
							</div>
							<p class="mb-3 text-xs" style="color: var(--color-ink-faint);">
								{sourceUrl ? 'Shared link' : 'Text shared from another app'}
							</p>
						{/if}
						{#if sharedImageDataUrl}
							<img
								src={sharedImageDataUrl}
								alt=""
								class="mb-3 max-h-48 w-full rounded-[var(--radius-md)] object-cover"
								style="background: var(--color-surface-2);"
							/>
						{:else if sharedImageTooLarge}
							<p class="mb-3 text-xs" style="color: var(--color-danger);">
								Image is too large to attach right now — saving the text only.
							</p>
						{/if}
						<div class="flex gap-3">
							{#if fetchedImage && !sharedImageDataUrl}
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
								<p
									class="line-clamp-3 leading-snug"
									style={sourceUrl || sharedImageDataUrl
										? 'font-size: 0.95rem; font-weight: 500;'
										: "font-family: Georgia, 'Times New Roman', serif; font-size: 1.5rem; font-weight: 400;"}
								>
									{displayTitle}
								</p>
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
				{/if}

				<textarea
					bind:value={caption}
					placeholder="Add a thought…"
					rows="2"
					class="w-full resize-none rounded-[var(--radius-lg)] px-4 py-3.5 text-[0.95rem] outline-none"
					style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-ink);"
				></textarea>
			</div>

			<div class="shrink-0 pb-4">
				<p class="mb-2 text-xs font-medium tracking-wide uppercase" style="color: var(--color-ink-faint);">
					Save with a tag
				</p>
				<div class="grid grid-cols-3 gap-2.5">
					{#each QUICK_TAGS as tag (tag)}
						{@const done = submittedKey === tag}
						<button
							onclick={() => saveWith([tag], tag)}
							disabled={submitted}
							class="flex aspect-square flex-col items-start justify-between rounded-[var(--radius-lg)] p-3 text-left text-sm font-semibold disabled:opacity-100"
							style={done
								? 'background: var(--color-success-soft); color: var(--color-success);'
								: `background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-ink); ${submitted ? 'opacity: 0.4;' : ''}`}
						>
							{#if done}
								<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"
									><path d="M20 6 9 17l-5-5" /></svg
								>
							{:else}
								<span class="text-lg font-bold" style="color: var(--color-accent);">#</span>
								<span>{tag}</span>
							{/if}
						</button>
					{/each}
					<button
						onclick={openInEditor}
						disabled={submitted}
						class="flex aspect-square flex-col items-start justify-between rounded-[var(--radius-lg)] p-3 text-left text-sm font-semibold"
						style="background: var(--color-ink); color: var(--color-bg); {submitted ? 'opacity: 0.4;' : ''}"
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
							><path d="M7 17 17 7M8 7h9v9" /></svg
						>
						Open
					</button>
				</div>

				<button
					onclick={() => saveWith([], 'inbox')}
					disabled={submitted}
					class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] py-4 text-base font-semibold"
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
						Just save<span class="text-sm font-normal opacity-80">to Inbox</span>
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
