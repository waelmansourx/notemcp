<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { hostname } from '$lib/dates';
	import { normalizeTagName } from '$lib/tags';
	import { queueNote, syncEntryNow } from '$lib/outbox';
	import { addPending, removePending } from '$lib/stream.svelte';
	import { filing, fileInto, unfile, restore } from '$lib/composer.svelte';
	import { QUICK_TAGS, type GroupStub } from '$lib/types';
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
	let fallbackSubtext = $derived(
		leftoverText && leftoverText !== fallbackTitle ? leftoverText : ''
	);
	let displayTitle = $derived(fetchedTitle || fallbackTitle);
	let displaySubtext = $derived(fetchedDescription || fallbackSubtext);

	// If you were already writing in a tag when you shared this, the share
	// lands there too — collecting four links into one place is the whole
	// point. It's never silent: that tag is the first button in the grid and
	// wears the group marker, so where this is going is visible before you tap.
	onMount(restore);

	// Sharing from another app is a capture surface in its own right, not a
	// fallback for the in-app composer — so it offers the same groups the
	// composer does, instead of choosing between five hard-coded tags.
	let recentGroups = $derived((page.data.recentGroups ?? []) as GroupStub[]);

	// The tag you're already in first, then your own, topped up from the
	// defaults so the grid is always full — six fits two rows without the
	// sheet growing a scroll.
	let quickTags = $derived.by(() => {
		const names: string[] = [];
		for (const name of [filing.tag, ...recentGroups.map((g) => g.name), ...QUICK_TAGS]) {
			if (name && !names.includes(name)) names.push(name);
		}
		return names.slice(0, 6);
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

	function save(tagNames: string[], key: string) {
		if (submitted) return;
		submitted = true;
		savedTag = key;

		const names = tagNames.map(normalizeTagName).filter(Boolean);

		const entry = queueNote({
			title: displayTitle,
			content_markdown: buildContent(),
			source_url: sourceUrl,
			source_type: sourceUrl || sharedImageDataUrl ? 'share' : null,
			source_title: fetchedTitle,
			source_description: fetchedDescription,
			source_image: fetchedImage,
			tagNames: names
		});

		// Where this went is where the next thought goes — including back in the
		// app, since the sticky group is shared by every capture surface.
		// "Just save" is an explicit no-tag, so it also means "not there any more".
		if (names[0]) fileInto(names[0]);
		else unfile();

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
			style="background: var(--color-surface); --fade-to: var(--color-surface); box-shadow: 0 -8px 34px rgba(0,0,0,.16); padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));"
			transition:fly={{ y: 420, duration: 320, easing: quintOut }}
			onclick={(e) => e.stopPropagation()}
			role="presentation"
		>
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
				{:else if sharedImageDataUrl}
					<img
						src={sharedImageDataUrl}
						alt=""
						class="mb-3 max-h-44 w-full rounded-[16px] object-cover"
						style="background: var(--color-surface-2);"
					/>
				{/if}

				{#if !sharedImageDataUrl || sourceUrl}
					<div
						class="mb-3 flex items-start gap-3 rounded-[16px] p-2.5"
						style="background: var(--color-surface-2);"
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

				{#if sharedImageTooLarge}
					<p class="mb-2 text-[0.78rem]" style="color: var(--color-danger);">
						That image is too large to attach right now — saving the text only.
					</p>
				{/if}

				<textarea
					bind:this={captionEl}
					bind:value={caption}
					placeholder="Add a thought…"
					rows="2"
					class="mb-3 w-full resize-none bg-transparent font-serif text-[1.06rem] leading-[1.44] tracking-[-0.017em] outline-none"
				></textarea>
			</div>

			<!--
				Six tags, and tapping one saves. Selecting a tag and then
				confirming is the right shape inside the app, where you're
				already writing; here you're standing in another app with the
				thing half-shared, and the whole value is that filing it costs
				one tap. So the tag *is* the button.

				This grid used to sit under a strip of recent notes to continue —
				two different answers to "where does this go?", one of which made
				a group have a head. There is one answer now, and the tag you're
				already in is simply the first button, marked.
			-->
			<div class="mb-2.5 grid shrink-0 grid-cols-3 gap-2">
				{#each quickTags as tag (tag)}
					{@const current = tag === filing.tag}
					<button
						type="button"
						disabled={submitted}
						class="flex h-[2.75rem] items-center justify-center rounded-[14px] text-[0.9rem] font-bold tracking-[-0.015em] active:scale-[0.97] disabled:opacity-40"
						style={savedTag === tag
							? 'background: var(--color-success-soft); color: var(--color-success);'
							: current
								? 'background: var(--color-accent-soft); color: var(--color-accent);'
								: 'background: var(--color-surface-2); color: var(--color-ink);'}
						onclick={() => save([tag], tag)}
					>
						{#if savedTag === tag}
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
						{:else}
							<span style={current ? '' : 'color: var(--color-accent);'}>#</span>{tag}
						{/if}
					</button>
				{/each}
			</div>

			<!-- Dismissing sits at the far left, a whole button away from Save:
			     they're both one tap, and only one of them is recoverable. -->
			<div class="flex shrink-0 items-center gap-2">
				<button
					type="button"
					aria-label="Cancel"
					disabled={submitted}
					class="grid h-[2.875rem] w-[2.875rem] shrink-0 place-items-center rounded-full disabled:opacity-40"
					style="background: var(--color-surface-2); color: var(--color-ink-2);"
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
					aria-label="Open in the editor"
					disabled={submitted}
					class="grid h-[2.875rem] w-[2.875rem] shrink-0 place-items-center rounded-full disabled:opacity-40"
					style="background: var(--color-surface-2); color: var(--color-ink-2);"
					onclick={openInEditor}
				>
					<svg
						width="17"
						height="17"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.2"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg
					>
				</button>

				<button
					type="button"
					disabled={submitted}
					class="flex h-[2.875rem] flex-1 items-center justify-center gap-1.5 rounded-full text-[1rem] font-bold tracking-[-0.015em] active:scale-[0.98]"
					style={savedTag === 'inbox'
						? 'background: var(--color-success-soft); color: var(--color-success);'
						: 'background: var(--color-accent); color: var(--color-accent-ink); box-shadow: 0 8px 20px rgba(20,80,58,.24);'}
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
						Just save<span class="text-[0.82rem] font-medium opacity-75">to Inbox</span>
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
