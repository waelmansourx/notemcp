<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { hostname } from '$lib/dates';
	import { extractHashtags, normalizeTagName } from '$lib/tags';
	import { queueNote, syncEntryNow } from '$lib/outbox';
	import { addPending, removePending } from '$lib/stream.svelte';
	import { continuation, detach, restore, touch } from '$lib/composer.svelte';
	import { ImageAttachments, imageFilesFrom } from '$lib/composer/image-attachments.svelte';
	import { LinkPreview } from '$lib/composer/link-preview.svelte';
	import AttachmentTray from '$lib/components/AttachmentTray.svelte';
	import LinkPreviewCard from '$lib/components/LinkPreviewCard.svelte';
	import { suggestions } from '$lib/cache.svelte';
	import { QUICK_TAGS } from '$lib/types';
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	const SHARE_CACHE = 'notemcp-share-v1';

	const params = page.url.searchParams;
	const rawTitle = params.get('title') ?? '';
	const rawText = params.get('text') ?? '';
	const rawUrl = params.get('url') ?? '';
	const sharedIds = params.getAll('shared');

	const urlRegex = /https?:\/\/\S+/i;
	const foundUrl = rawUrl || rawText.match(urlRegex)?.[0] || rawTitle.match(urlRegex)?.[0] || '';
	const sourceUrl = foundUrl || null;
	const leftoverText = rawText.replace(urlRegex, '').trim();

	const link = new LinkPreview({ url: sourceUrl });
	const sharedImages = new ImageAttachments();
	let sharedImageLoading = $state(sharedIds.length > 0);
	let sharedImageInput = $state<HTMLInputElement | null>(null);

	let fallbackTitle = $derived(
		rawTitle ||
			leftoverText ||
			(sourceUrl
				? hostname(sourceUrl)
				: sharedIds.length || sharedImages.items.length
					? 'Shared image'
					: 'Shared item')
	);
	let fallbackSubtext = $derived(
		leftoverText && leftoverText !== fallbackTitle ? leftoverText : ''
	);
	let displayTitle = $derived(link.title || fallbackTitle);
	let displaySubtext = $derived(link.description || fallbackSubtext);

	onMount(restore);

	let recentTags = $derived(suggestions.recent);
	let quickTags = $derived.by(() => {
		const names: string[] = [];
		for (const name of [...recentTags.map((t) => t.name), ...QUICK_TAGS]) {
			if (name && !names.includes(name)) names.push(name);
		}
		return names.slice(0, 5);
	});

	let caption = $state('');
	let captionEl = $state<HTMLTextAreaElement | null>(null);
	let submitted = $state(false);
	let savedTag = $state<string | null>(null);
	let dismissed = $state(false);

	function focusCaptionAfterIntro() {
		requestAnimationFrame(() => {
			captionEl?.focus({ preventScroll: true });
		});
	}

	onMount(() => {
		if (sourceUrl) link.fetch(sourceUrl);

		if (sharedIds.length > 0) {
			(async () => {
				try {
					const cache = await caches.open(SHARE_CACHE);
					const blobs = await Promise.all(
						sharedIds.map(async (id) => {
							const key = `/__share/${id}`;
							const res = await cache.match(key);
							await cache.delete(key);
							return res?.blob() ?? null;
						})
					);
					sharedImages.attach(blobs.filter((blob): blob is Blob => blob !== null));
				} catch {
					// no image ever arrives — just proceed as a text-only capture
				} finally {
					sharedImageLoading = false;
				}
			})();
		}
	});

	function onSharedImageChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		sharedImages.attach(files);
	}

	function onSharedImagePaste(event: ClipboardEvent) {
		const files = imageFilesFrom(event.clipboardData);
		if (files.length === 0) return;
		event.preventDefault();
		sharedImages.attach(files);
	}

	function onSharedImageDragOver(event: DragEvent) {
		if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		sharedImages.dragging = true;
	}

	function onSharedImageDragLeave(event: DragEvent) {
		const current = event.currentTarget as HTMLElement;
		if (event.relatedTarget instanceof Node && current.contains(event.relatedTarget)) return;
		sharedImages.dragging = false;
	}

	function onSharedImageDrop(event: DragEvent) {
		event.preventDefault();
		sharedImages.dragging = false;
		sharedImages.attach(imageFilesFrom(event.dataTransfer));
	}

	function buildContent(): string {
		const parts: string[] = [];
		const images = sharedImages.markdown('Shared image');
		if (images) parts.push(images);
		if (caption.trim()) parts.push(caption.trim());
		return parts.join('\n\n');
	}

	async function finishImageStarts() {
		await sharedImages.waitForIds();
	}

	async function leave(sending?: Promise<unknown>) {
		dismissed = true;
		const navigation = Promise.race([
			goto('/', { replaceState: true, noScroll: true }),
			new Promise((resolve) => setTimeout(resolve, 800))
		]);

		await Promise.allSettled([navigation, sending ?? Promise.resolve()]);
		window.close();
	}

	async function insertHashtag() {
		if (submitted) return;
		const el = captionEl;
		const start = el?.selectionStart ?? caption.length;
		const end = el?.selectionEnd ?? caption.length;
		const prev = caption[start - 1];
		const insert = (prev && !/\s/.test(prev) ? ' ' : '') + '#';
		caption = caption.slice(0, start) + insert + caption.slice(end);
		const cursor = start + insert.length;
		await tick();
		el?.focus();
		el?.setSelectionRange(cursor, cursor);
	}

	async function save(tagNames: string[], key: string) {
		if (submitted) return;
		submitted = true;
		savedTag = key;
		await finishImageStarts();

		const allTags = [...tagNames, ...extractHashtags(caption)];
		const entry = queueNote({
			title: displayTitle,
			content_markdown: buildContent(),
			source_url: sourceUrl,
			source_type: sourceUrl || sharedImages.items.length ? 'share' : null,
			source_title: link.title,
			source_description: link.description,
			source_image: link.image,
			parent_id: continuation.target?.id ?? null,
			tagNames: [...new Set(allTags.map(normalizeTagName).filter(Boolean))]
		});
		touch();

		addPending(entry);
		const uploadsFinished = sharedImages.waitForUploads();
		leave(
			Promise.all([
				syncEntryNow(entry).then((noteId) => {
					if (noteId) removePending(entry.client_id);
				}),
				uploadsFinished
			])
		);
	}

	async function openInEditor() {
		if (submitted) return;
		await finishImageStarts();
		const q = new URLSearchParams();
		if (displayTitle) q.set('title', displayTitle);
		const content = buildContent() || caption || leftoverText;
		if (content) q.set('content', content);
		if (sourceUrl) q.set('source_url', sourceUrl);
		if (link.title) q.set('source_title', link.title);
		if (link.description) q.set('source_description', link.description);
		if (link.image) q.set('source_image', link.image);
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
			class="flex max-h-[92vh] flex-col rounded-t-[1.375rem] px-[1.125rem] pt-[0.625rem]"
			style={sharedImages.dragging
				? 'background: var(--color-surface); --fade-to: var(--color-surface); box-shadow: inset 0 0 0 3px var(--color-accent), 0 -8px 34px rgba(0,0,0,.16); padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));'
				: 'background: var(--color-surface); --fade-to: var(--color-surface); box-shadow: 0 -8px 34px rgba(0,0,0,.16); padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));'}
			transition:fly={{ y: 420, duration: 320, easing: quintOut }}
			onintroend={focusCaptionAfterIntro}
			onclick={(e) => e.stopPropagation()}
			onpaste={onSharedImagePaste}
			ondragover={onSharedImageDragOver}
			ondragleave={onSharedImageDragLeave}
			ondrop={onSharedImageDrop}
			role="presentation"
		>
			<div
				class="mx-auto mb-3 h-1 w-9 shrink-0 rounded-full"
				style="background: var(--color-border);"
			></div>

			<div class="min-h-0 flex-1 overflow-y-auto">
				{#if sharedImageLoading}
					<div
						class="mb-3 flex h-28 items-center justify-center rounded-[16px]"
						style="background: var(--color-surface-2);"
					>
						<div
							class="h-5 w-5 animate-spin rounded-full border-2"
							style="border-color: var(--color-border); border-top-color: var(--color-accent);"
						></div>
					</div>
				{:else}
					<AttachmentTray attachments={sharedImages} size="large" class="mb-3" />
				{/if}

				{#if sharedImages.items.length === 0 || sourceUrl}
					<LinkPreviewCard
						preview={link}
						mode="capture"
						fallbackTitle={displayTitle}
						fallbackDescription={displaySubtext}
						removable={false}
						class="mb-3"
					/>
				{/if}

				<textarea
					bind:this={captionEl}
					bind:value={caption}
					placeholder="Add a thought…"
					inputmode="text"
					rows="2"
					class="mb-3 w-full resize-none bg-transparent font-serif text-[1.18rem] leading-[1.5] tracking-[-0.017em] outline-none"
				></textarea>
			</div>

			{#if continuation.target}
				<div class="mb-2.5 flex shrink-0 items-center gap-2 rounded-[14px] py-1.5 pr-1.5 pl-2.5">
					<span class="shrink-0 text-[0.85rem] leading-none" style="color: var(--color-accent);"
						>&#8627;</span
					>
					{#if continuation.target.image}
						<img
							src={continuation.target.image}
							alt=""
							class="h-7 w-7 shrink-0 rounded-[8px] object-cover"
							style="background: var(--color-surface-2);"
						/>
					{/if}
					<span
						class="min-w-0 flex-1 truncate text-[0.8rem] font-bold tracking-[-0.015em]"
						style="color: var(--color-accent);"
					>
						{continuation.target.label}
					</span>
					<button
						type="button"
						aria-label="Save on its own instead"
						class="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.68rem] active:scale-90"
						style="background: color-mix(in srgb, var(--color-accent) 16%, transparent); color: var(--color-accent);"
						onclick={detach}
					>
						&#10005;
					</button>
				</div>
			{/if}

			<div class="mb-2.5 grid shrink-0 grid-cols-3 gap-2.5">
				{#each quickTags as tag (tag)}
					<button
						type="button"
						disabled={submitted}
						class="flex h-[4rem] min-w-0 flex-col justify-between rounded-[16px] p-2.5 text-left transition-transform active:scale-[0.97] disabled:opacity-40"
						style={savedTag === tag
							? 'background: var(--color-success-soft); color: var(--color-success);'
							: 'background: var(--color-surface-2); color: var(--color-ink); border: 1px solid var(--color-border);'}
						onclick={() => save([tag], tag)}
					>
						{#if savedTag === tag}
							<div class="flex h-full w-full items-center justify-center">
								<svg
									width="20"
									height="20"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.6"
									stroke-linecap="round"
									stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
								>
							</div>
						{:else}
							<span class="text-[1.05rem] font-bold leading-none" style="color: var(--color-ink-faint);">#</span>
							<span class="w-full truncate text-[0.85rem] font-bold tracking-[-0.01em]">
								{tag}
							</span>
						{/if}
					</button>
				{/each}

				<button
					type="button"
					aria-label="Open in the editor"
					disabled={submitted}
					class="flex h-[4rem] min-w-0 flex-col justify-between rounded-[16px] p-2.5 text-left transition-transform active:scale-[0.97] disabled:opacity-40"
					style="background: var(--color-ink); color: var(--color-surface);"
					onclick={openInEditor}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.4"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="opacity-80"
					>
						<path d="M7 17 17 7M8 7h9v9" />
					</svg>
					<span class="w-full truncate text-[0.85rem] font-bold tracking-[-0.01em]">Open</span>
				</button>
			</div>

			<div class="flex shrink-0 items-center gap-2">
				<button
					type="button"
					aria-label="Cancel"
					disabled={submitted}
					class="grid h-[2.875rem] w-[2.875rem] shrink-0 place-items-center rounded-full disabled:opacity-40"
					style="background: var(--color-danger-soft); color: var(--color-danger);"
					onclick={() => leave()}
				>
					<svg
						width="17"
						height="17"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.2"
						stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg
					>
				</button>

				<input
					bind:this={sharedImageInput}
					type="file"
					accept="image/*"
					multiple
					class="hidden"
					onchange={onSharedImageChosen}
				/>
				<button
					type="button"
					aria-label="Add an image"
					disabled={submitted}
					class="grid h-[2.875rem] w-[2.875rem] shrink-0 place-items-center rounded-full disabled:opacity-40"
					style="background: var(--color-surface-2); color: var(--color-ink-2);"
					onclick={() => sharedImageInput?.click()}
				>
					<svg
						width="17"
						height="17"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.9"
						stroke-linecap="round"
						stroke-linejoin="round"
						><rect x="3" y="4" width="18" height="16" rx="3" /><circle
							cx="8.5"
							cy="9.5"
							r="1.5"
						/><path d="M3 16l5-4 4 3 3-2 6 4" /></svg
					>
				</button>

				<button
					type="button"
					aria-label="Add a tag"
					disabled={submitted}
					class="grid h-[2.875rem] w-[4.3125rem] shrink-0 place-items-center rounded-full text-[1.15rem] font-bold active:scale-95 disabled:opacity-40"
					style="background: var(--color-accent-soft); color: var(--color-accent);"
					onclick={insertHashtag}
				>
					#
				</button>

				<button
					type="button"
					disabled={submitted}
					class="flex h-[2.875rem] flex-1 items-center justify-center gap-1.5 rounded-full text-[1rem] font-bold tracking-[-0.015em] active:scale-[0.98] disabled:opacity-40"
					style={savedTag === 'inbox'
						? 'background: var(--color-success-soft); color: var(--color-success);'
						: 'background: var(--color-surface-2); color: var(--color-ink);'}
					onclick={() => save([], 'inbox')}
				>
					{#if savedTag === 'inbox'}
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.6"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
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
