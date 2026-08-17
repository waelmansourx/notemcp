<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { hostname } from '$lib/dates';
	import { QUICK_TAGS } from '$lib/types';
	import { queueNote, syncEntry, syncEntryNow } from '$lib/outbox';
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
	async function leave() {
		dismissed = true;
		await goto('/', { replaceState: true, noScroll: true });
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

		if (sharedImageDataUrl) {
			// The embedded image can be well over keepalive's safe size, so
			// wait for the real upload rather than firing-and-leaving.
			syncEntryNow(entry).then(leave);
		} else {
			// localStorage write above is already durable, and the POST goes
			// out with keepalive, so there's nothing left to wait on — just a
			// beat for the checkmark to register before the sheet closes.
			syncEntry(entry);
			setTimeout(leave, 150);
		}
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
				<div class="grid grid-cols-3 gap-2.5">
					{#each QUICK_TAGS as tag (tag)}
						{@const done = submittedKey === tag}
						<button
							onclick={() => saveWith([tag], tag)}
							disabled={submitted}
							class="flex aspect-square flex-col items-center justify-center gap-1 rounded-[var(--radius-lg)] text-sm font-medium disabled:opacity-100"
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
					onclick={() => saveWith([], 'inbox')}
					disabled={submitted}
					class="mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] py-4 text-base font-medium"
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
