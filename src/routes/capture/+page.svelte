<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { hostname } from '$lib/dates';
	import { extractHashtags, normalizeTagName } from '$lib/tags';
	import { queueNote, syncEntryNow } from '$lib/outbox';
	import { addPending, removePending } from '$lib/stream.svelte';
	import { continuation, detach, restore, touch } from '$lib/composer.svelte';
	import { beginMediaUpload, compressImage, type PendingMedia } from '$lib/media';
	import { suggestions } from '$lib/cache.svelte';
	import { QUICK_TAGS } from '$lib/types';
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	const SHARE_CACHE = 'notemcp-share-v1';
	const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
	const MAX_SOURCE_IMAGE_BYTES = 25 * 1024 * 1024;
	const MAX_IMAGES = 10;

	const params = page.url.searchParams;
	const rawTitle = params.get('title') ?? '';
	const rawText = params.get('text') ?? '';
	const rawUrl = params.get('url') ?? '';
	const sharedIds = params.getAll('shared');

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

	// Shared screenshots/photos, pulled out of Cache Storage where the
	// service worker stashed it (see src/service-worker.ts) and uploaded to
	// R2 in the background (see ADR-001). sharedImageDataUrl is a local
	// preview only — never written into the saved note, which instead gets
	// the stable /api/media/{id} ref as soon as the (fast) signing request
	// resolves. If sharing happens with genuinely no connection, that
	// request never resolves either, and the note saves as text-only rather
	// than embedding the raw bytes.
	type SharedImage = {
		key: string;
		dataUrl: string;
		mediaId: string | null;
		uploadStart: Promise<PendingMedia> | null;
		uploadError: boolean;
		processing: boolean;
	};
	let sharedImages = $state<SharedImage[]>([]);
	let sharedImageError = $state<string | null>(null);
	let sharedImageLoading = $state(sharedIds.length > 0);
	let sharedImageDragging = $state(false);
	let sharedImageInput = $state<HTMLInputElement | null>(null);
	const sharedImagePreparations = new Set<Promise<void>>();

	let fallbackTitle = $derived(
		rawTitle ||
			leftoverText ||
			(sourceUrl
				? hostname(sourceUrl)
				: sharedIds.length || sharedImages.length
					? 'Shared image'
					: 'Shared item')
	);
	let fallbackSubtext = $derived(
		leftoverText && leftoverText !== fallbackTitle ? leftoverText : ''
	);
	let displayTitle = $derived(fetchedTitle || fallbackTitle);
	let displaySubtext = $derived(fetchedDescription || fallbackSubtext);

	// If you were already adding to a thread when you shared this, the share
	// lands there too — collecting four links into one place is the whole
	// point. It's never silent: the chip below the preview says where this is
	// going and gets you out of it in one tap.
	onMount(restore);

	// Focus the caption the instant the sheet mounts rather than waiting on
	// its entrance transition — the sheet is already visible enough to type
	// into well before it finishes sliding up. The native `autofocus` on the
	// field gives the browser the same intent before this component hydrates;
	// the onintroend re-focus below stays as a backstop for Android, where a
	// caret that appears mid-slide sometimes doesn't bring the IME with it.
	onMount(() => {
		captionEl?.focus();
	});

	// Sharing from another app is a capture surface in its own right, not a
	// fallback for the in-app composer — so it gets the same row of your own
	// tags instead of five hard-coded ones. Like the composer, it no longer
	// offers a thread to file under before you've written anything: the chip
	// below only shows a thread you already chose from the note itself.
	// Your own tags first, topped up from the defaults so the grid is always
	// full — six is what fits two rows without the sheet growing a scroll.
	// Read from the local cache rather than `page.data`: the layout streams the
	// row now, and the share sheet is the one surface that can't afford to wait
	// for it — you're here for two seconds, and the tags have to be there on
	// the first frame or you may as well not have them.
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
	/** Which button is showing its checkmark: a tag name, or 'inbox'. */
	let savedTag = $state<string | null>(null);
	let dismissed = $state(false);

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
					attachSharedImages(blobs.filter((blob): blob is Blob => blob !== null));
				} catch {
					// no image ever arrives — just proceed as a text-only capture
				} finally {
					sharedImageLoading = false;
				}
			})();
		}
	});

	function dataUrlFor(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});
	}

	function imageFilesFrom(data: DataTransfer | null): File[] {
		if (!data) return [];
		const files = Array.from(data.files).filter((file) => file.type.startsWith('image/'));
		if (files.length > 0) return files;
		return Array.from(data.items)
			.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
			.map((item) => item.getAsFile())
			.filter((file): file is File => file !== null);
	}

	function attachSharedImages(blobs: Blob[]) {
		const images = blobs.filter((blob) => blob.type.startsWith('image/'));
		if (images.length === 0) return;
		sharedImageError = null;
		const remaining = MAX_IMAGES - sharedImages.length;
		if (remaining <= 0) {
			sharedImageError = `You can attach up to ${MAX_IMAGES} images.`;
			return;
		}
		if (images.length > remaining) sharedImageError = `You can attach up to ${MAX_IMAGES} images.`;

		for (const source of images.slice(0, remaining)) {
			if (source.size > MAX_SOURCE_IMAGE_BYTES) {
				sharedImageError = 'One of those images is too large to process (25MB max).';
				continue;
			}
			const image = $state<SharedImage>({
				key: crypto.randomUUID(),
				dataUrl: '',
				mediaId: null,
				uploadStart: null,
				uploadError: false,
				processing: true
			});
			sharedImages.push(image);

			const preparation = (async () => {
				try {
					const { blob } = await compressImage(source, { maxBytes: MAX_IMAGE_BYTES });
					if (blob.size > MAX_IMAGE_BYTES) {
						image.uploadError = true;
						sharedImageError = 'One image is still over 4MB after compression.';
						return;
					}
					image.dataUrl = await dataUrlFor(blob);
					const started = beginMediaUpload(blob, 'image');
					image.uploadStart = started;
					started
						.then(({ id, whenUploaded }) => {
							image.mediaId = id;
							whenUploaded.catch(() => {
								image.mediaId = null;
								image.uploadError = true;
							});
						})
						.catch(() => (image.uploadError = true));
				} catch {
					image.uploadError = true;
				} finally {
					image.processing = false;
					captionEl?.focus();
				}
			})();
			sharedImagePreparations.add(preparation);
			preparation.finally(() => sharedImagePreparations.delete(preparation));
		}
	}

	function removeSharedImage(key: string) {
		sharedImages = sharedImages.filter((image) => image.key !== key);
		if (sharedImages.every((image) => !image.uploadError)) sharedImageError = null;
	}

	function onSharedImageChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		attachSharedImages(files);
	}

	function onSharedImagePaste(event: ClipboardEvent) {
		const files = imageFilesFrom(event.clipboardData);
		if (files.length === 0) return;
		event.preventDefault();
		attachSharedImages(files);
	}

	function onSharedImageDragOver(event: DragEvent) {
		if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		sharedImageDragging = true;
	}

	function onSharedImageDragLeave(event: DragEvent) {
		const current = event.currentTarget as HTMLElement;
		if (event.relatedTarget instanceof Node && current.contains(event.relatedTarget)) return;
		sharedImageDragging = false;
	}

	function onSharedImageDrop(event: DragEvent) {
		event.preventDefault();
		sharedImageDragging = false;
		attachSharedImages(imageFilesFrom(event.dataTransfer));
	}

	function buildContent(): string {
		const parts: string[] = [];
		for (const image of sharedImages) {
			if (image.mediaId) parts.push(`![Shared image](/api/media/${image.mediaId})`);
		}
		if (caption.trim()) parts.push(caption.trim());
		return parts.join('\n\n');
	}

	async function finishImageStarts() {
		await Promise.allSettled([...sharedImagePreparations]);
		await Promise.allSettled(
			sharedImages
				.filter((image) => !image.mediaId && !image.uploadError)
				.map((image) => image.uploadStart)
		);
	}

	// Android launches a share-target navigation as a fresh activity with no
	// prior history, which is precisely the condition browsers require to
	// honor a script-initiated window.close() — so this has a real shot at
	// dropping the user straight back into the app they shared from. We move
	// to "/" first (replacing this history entry) before trying, so that if
	// the OS kills the process before close() lands, relaunching the app
	// resumes on the home river instead of a dead capture screen.
	async function leave(sending?: Promise<unknown>) {
		// The history entry is what has to land before close() — not the root
		// layout's own streamed data. Waiting on goto() unconditionally meant
		// a slow or flaky connection right after a share intent could leave the
		// sheet stuck on screen indefinitely; capping the wait keeps this
		// bounded without giving up the safety net the history replace exists
		// for.
		await Promise.race([
			goto('/', { replaceState: true, noScroll: true }),
			new Promise((resolve) => setTimeout(resolve, 800))
		]);
		dismissed = true;
		// Closing the tab aborts anything still in flight, so that — and only
		// that — waits for the upload. The sheet is already gone by then.
		if (sending) await sending.catch(() => {});
		window.close();
	}

	// Inserts "#" at the caret rather than opening a picker — same move as
	// typing a hashtag into a caption on TikTok. save() below pulls it (and
	// whatever name gets typed after it) back out of the caption text, so
	// this needs no state of its own.
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

		// A tag tap here can easily beat the signing round trip (there's no
		// typing pause like the in-app composer has), so wait for it — never
		// for the full upload, just the fast id-issuing step.
		await finishImageStarts();

		// Whatever's typed inline (see insertHashtag) joins whatever tag button
		// was tapped, if any — the two aren't alternatives, they're the same
		// "what's this about" answer said two different ways.
		const allTags = [...tagNames, ...extractHashtags(caption)];

		const entry = queueNote({
			title: displayTitle,
			content_markdown: buildContent(),
			source_url: sourceUrl,
			source_type: sourceUrl || sharedImages.length ? 'share' : null,
			source_title: fetchedTitle,
			source_description: fetchedDescription,
			source_image: fetchedImage,
			parent_id: continuation.target?.id ?? null,
			tagNames: [...new Set(allTags.map(normalizeTagName).filter(Boolean))]
		});
		touch();

		// The note is durable in localStorage the moment queueNote() returns,
		// and the server now keys on client_id so a retry can't duplicate it.
		// Nothing about the round trip is worth standing still for: show it in
		// the stream and go. Waiting on the upload here — which is what the
		// image path used to do — is what made saving a shared photo feel like
		// the app had hung.
		addPending(entry);
		const uploadsFinished = Promise.allSettled(
			sharedImages.map(async (image) => {
				const pending = await image.uploadStart;
				if (pending) await pending.whenUploaded;
			})
		);
		leave(
			Promise.all([
				syncEntryNow(entry).then((noteId) => {
					// Once it's on the server the stream will load it for real, so the
					// local stand-in has done its job.
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
		<!--
			The share sheet, speaking the composer's language.

			It used to answer "where does this go?" with a 3×2 grid of five
			hard-coded tags — six big targets competing for attention before
			you'd even read what you shared. Now it's the same three rows the
			in-app composer uses, in the same order: what you're saving, where
			it continues, what it's about. The primary action is still exactly
			one tap away.
		-->
		<div
			class="flex max-h-[92vh] flex-col rounded-t-[1.375rem] px-[1.125rem] pt-[0.625rem]"
			style={sharedImageDragging
				? 'background: var(--color-surface); --fade-to: var(--color-surface); box-shadow: inset 0 0 0 3px var(--color-accent), 0 -8px 34px rgba(0,0,0,.16); padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));'
				: 'background: var(--color-surface); --fade-to: var(--color-surface); box-shadow: 0 -8px 34px rgba(0,0,0,.16); padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));'}
			transition:fly={{ y: 420, duration: 320, easing: quintOut }}
			onintroend={() => captionEl?.focus()}
			onclick={(e) => e.stopPropagation()}
			onpaste={onSharedImagePaste}
			ondragover={onSharedImageDragOver}
			ondragleave={onSharedImageDragLeave}
			ondrop={onSharedImageDrop}
			role="presentation"
		>
			<!-- Focusing while the sheet is still translating up gets a visible
			     caret but no keyboard on Android — the IME wants the field settled
			     first. Waiting for the sheet's own entrance transition to finish
			     is a free, reliable signal for "settled" without a magic delay. -->
			<div
				class="mx-auto mb-3 h-1 w-9 shrink-0 rounded-full"
				style="background: var(--color-border);"
			></div>

			<div class="min-h-0 flex-1 overflow-y-auto">
				<!-- What you shared. Its own words stay secondary to yours: the
				     caption box below is the serif one, because the note is your
				     thought and not the article's headline. -->
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
				{:else if sharedImages.length > 0}
					<div class="mb-3 flex gap-2 overflow-x-auto pt-1 pr-1">
						{#each sharedImages as image (image.key)}
							<div class="relative shrink-0">
								{#if image.dataUrl}
									<img
										src={image.dataUrl}
										alt=""
										class="h-32 w-32 rounded-[16px] object-cover"
										class:opacity-50={image.processing || image.uploadError}
										style="background: var(--color-surface-2);"
									/>
								{:else}
									<div
										class="h-32 w-32 animate-pulse rounded-[16px]"
										style="background: var(--color-surface-2);"
									></div>
								{/if}
								{#if image.processing}
									<span
										class="absolute inset-0 grid place-items-center text-[0.68rem] font-bold"
										style="color: var(--color-ink-muted);"
									>
										Compressing
									</span>
								{/if}
								<button
									type="button"
									aria-label="Remove image"
									class="absolute -top-1 -right-1 grid h-7 w-7 place-items-center rounded-full text-xs"
									style="background: var(--color-ink); color: var(--color-bg);"
									onclick={() => removeSharedImage(image.key)}
								>
									✕
								</button>
							</div>
						{/each}
					</div>
				{/if}

				{#if sharedImages.length === 0 || sourceUrl}
					<div
						class="mb-3 flex items-start gap-3 border-b pb-3"
						style="border-color: var(--color-border);"
					>
						{#if fetchedImage}
							<img
								src={fetchedImage}
								alt=""
								class="h-[52px] w-[52px] shrink-0 rounded-[13px] object-cover"
								style="background: var(--color-surface);"
							/>
						{/if}
						<div class="min-w-0 flex-1">
							{#if sourceUrl}
								<p
									class="mb-0.5 truncate text-[0.68rem] font-extrabold tracking-[0.04em] uppercase"
									style="color: var(--color-ink-faint);"
								>
									{hostname(sourceUrl)}
								</p>
							{/if}
							<p class="line-clamp-2 text-[0.88rem] leading-[1.3] font-semibold tracking-[-0.01em]">
								{displayTitle}
							</p>
							{#if displaySubtext}
								<p
									class="mt-0.5 line-clamp-1 text-[0.78rem]"
									style="color: var(--color-ink-muted);"
								>
									{displaySubtext}
								</p>
							{:else if previewLoading}
								<div
									class="mt-1.5 h-2 w-2/3 animate-pulse rounded-full"
									style="background: var(--color-surface);"
								></div>
							{/if}
						</div>
					</div>
				{/if}

				{#if sharedImageError || sharedImages.some((image) => image.uploadError)}
					<p class="mb-2 text-[0.78rem]" style="color: var(--color-danger);">
						{sharedImageError ?? "Couldn't upload one or more images — remove them or try again."}
					</p>
				{/if}

				<!-- svelte-ignore a11y_autofocus (a capture-only route should open ready to type) -->
				<textarea
					bind:this={captionEl}
					bind:value={caption}
					placeholder="Add a thought…"
					autofocus
					inputmode="text"
					rows="2"
					class="mb-3 w-full resize-none bg-transparent font-serif text-[1.18rem] leading-[1.5] tracking-[-0.017em] outline-none"
				></textarea>
			</div>

			<!-- Where it goes, then what it's about — the composer's order. -->
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

			<!-- Tags are choices, not six little destination cards. A single
			     scrolling line keeps every option one tap away without wrapping
			     the sheet in another grid of rounded containers. -->
			<div
				class="mb-3 flex shrink-0 items-center gap-4 overflow-x-auto border-y py-3"
				style="border-color: var(--color-border); scrollbar-width: none;"
			>
				{#each quickTags as tag (tag)}
					<button
						type="button"
						disabled={submitted}
						class="shrink-0 text-[0.85rem] font-bold tracking-[-0.01em] transition-transform active:scale-[0.97] disabled:opacity-40"
						style={savedTag === tag
							? 'color: var(--color-success);'
							: 'color: var(--color-accent);'}
						onclick={() => save([tag], tag)}
					>
						{#if savedTag === tag}
							<span class="flex items-center gap-1.5">
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.6"
									stroke-linecap="round"
									stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
								>
								#{tag}
							</span>
						{:else}
							#{tag}
						{/if}
					</button>
				{/each}

				<span class="h-4 w-px shrink-0" style="background: var(--color-border);"></span>

				<button
					type="button"
					aria-label="Open in the editor"
					disabled={submitted}
					class="flex shrink-0 items-center gap-1.5 text-[0.85rem] font-bold tracking-[-0.01em] transition-transform active:scale-[0.97] disabled:opacity-40"
					style="color: var(--color-ink-muted);"
					onclick={openInEditor}
				>
					<svg
						width="14"
						height="14"
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
					Open editor
				</button>
			</div>

			<!-- Cancel is the one destructive move here, so it reads reddish. The
				     "#" button is the tag picker: it drops a hashtag into the caption
				     instead of opening a separate row, so Save no longer has to
				     compete with a whole picker UI for attention — it's sized and
				     coloured like the quick tags next to it rather than shouting. -->
			<div class="flex shrink-0 items-center gap-2">
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

				<button
					type="button"
					aria-label="Add a tag"
					disabled={submitted}
					class="grid h-[2.875rem] w-[2.875rem] shrink-0 place-items-center rounded-full text-[1.15rem] font-bold active:scale-95 disabled:opacity-40"
					style="background: var(--color-surface-2); color: var(--color-accent);"
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
