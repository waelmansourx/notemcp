<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { openFilter } from '$lib/filter.svelte';
	import { showToast } from '$lib/toast.svelte';
	import { queueNote, syncEntry } from '$lib/outbox';
	import { addPending, settlePending, removePending } from '$lib/stream.svelte';
	import { normalizeTagName } from '$lib/tags';
	import { continuation, detach, touch, restore } from '$lib/composer.svelte';
	import { saveDraft, readDraft, clearDraft } from '$lib/draft.svelte';
	import TagPicker from './TagPicker.svelte';
	import type { Tag } from '$lib/types';
	import { onMount } from 'svelte';
	import { fly, fade, scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	let { contextTag = null }: { contextTag?: string | null } = $props();

	// From the root layout, so the row is the same here as on the share sheet.
	let recentTags = $derived((page.data.recentTags ?? []) as Tag[]);

	/* ---------------- phone sheet vs. desktop dock ----------------

	   On a phone the composer has to cover the stream to be reachable: there
	   is one column, and it's the stream, so opening it is a modal sheet you
	   explicitly enter and leave. A desktop window has room to just always
	   have it there instead — the same move Claude and Gemini make for their
	   own message box: a compact bar docked to the bottom of the column,
	   sitting over the stream rather than a full-screen sheet covering it,
	   growing as you type instead of jumping to a fixed sheet height, with no
	   backdrop because there's nothing modal about it.

	   Only one of the two is ever mounted, so there's exactly one textarea to
	   hold the caret and the draft survives a resize across the breakpoint
	   (the text lives in this component, not the DOM).
	*/
	let desktop = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(min-width: 64rem)');
		const sync = () => (desktop = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	let open = $state(false);
	let text = $state('');
	let selected = $state<string[]>([]);
	let textarea = $state<HTMLTextAreaElement | null>(null);

	let recording = $state(false);
	let seconds = $state(0);
	let interim = $state('');
	let voiceError = $state('');

	// Same base64-data-URL approach the share-target flow already uses for a
	// shared photo (src/routes/capture/+page.svelte) — no storage bucket to
	// stand up, and the outbox already falls back off keepalive for a big body.
	let photoInput = $state<HTMLInputElement | null>(null);
	let photoDataUrl = $state<string | null>(null);
	let photoTooLarge = $state(false);
	const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

	let hasContent = $derived(text.trim().length > 0 || Boolean(photoDataUrl));

	/* ---------------- continuing an earlier thought ----------------

	   Only ever entered from the thought itself: tapping "+" on an entry
	   attaches it and opens the composer. A blank composer used to open on a
	   row of recent threads to pick a parent from, which made starting a note
	   a choice about filing before it was a place to write — so the row is
	   gone and the chip below only appears once you've actually said "add to
	   this one".
	*/
	let target = $derived(continuation.target);

	// Short enough to sit in the collapsed bar next to a mic button.
	let barLabel = $derived(
		target ? (target.label.length > 24 ? target.label.slice(0, 23) + '…' : target.label) : ''
	);

	onMount(restore);

	/* ---------------- the draft survives everything ----------------

	   Text you typed but didn't keep used to live only in this component, so
	   navigating, reloading or letting the PWA get evicted took it with them —
	   the one thing a capture app is not allowed to do. It's written to
	   localStorage on every change instead (the same crash mat the note editor
	   uses), restored on mount, and dropped the moment the thought is either
	   saved or explicitly discarded.

	   The photo stays out of it: it's a base64 data URL, and localStorage is
	   also where a queued capture waits for the network.
	*/
	const DRAFT_ID = 'composer';

	onMount(() => {
		const draft = readDraft(DRAFT_ID);
		if (!draft) return;
		if (draft.content) text = draft.content;
		if (Array.isArray(draft.tags) && draft.tags.length > 0) selected = draft.tags;
	});

	$effect(() => {
		const content = text;
		const tags = selected;
		if (!content.trim() && tags.length === 0) clearDraft(DRAFT_ID);
		else saveDraft(DRAFT_ID, { title: '', content, tags });
	});

	// Tapping "+" on a thread both attaches it and opens the sheet — including
	// from a screen with no composer on it, since the request survives until
	// something is there to answer it.
	$effect(() => {
		if (!continuation.pendingOpen) return;
		continuation.pendingOpen = false;
		openSheet();
	});

	/* Search is a filter on the stream rather than a page of its own, so this
	   opens the filter bar — and gets you back to the stream first if you're
	   somewhere the stream isn't. */
	function search() {
		openFilter();
		if (page.url.pathname !== '/') goto('/');
	}

	function openSheet() {
		// Only a genuinely empty composer resets — reopening one that still
		// holds an unsaved thought has to give it back exactly as it was.
		if (!hasContent) {
			selected = contextTag ? [contextTag] : [];
			clearPhoto();
		}
		voiceError = '';
		// The dock is already there, so on desktop "opening the composer" only
		// ever means putting the caret in it.
		if (!desktop) open = true;
		// Autofocus immediately: the sheet exists to catch a thought that is
		// already half-gone, so the caret has to be there before the animation
		// finishes, not after.
		queueMicrotask(() => textarea?.focus());
	}

	function closeSheet() {
		open = false;
		interim = '';
	}

	/** Every exit keeps the text. Discarding is an explicit, separate action. */
	function dismiss() {
		if (hasContent) save();
		else closeSheet();
	}

	type DiscardSnapshot = { text: string; photoDataUrl: string | null; selected: string[] };
	let pendingDiscard = $state<DiscardSnapshot | null>(null);
	let discardTimer: ReturnType<typeof setTimeout> | null = null;
	const DISCARD_UNDO_MS = 4000;

	function discard() {
		if (!hasContent) {
			clearPhoto();
			closeSheet();
			return;
		}

		if (discardTimer) clearTimeout(discardTimer);
		pendingDiscard = { text, photoDataUrl, selected };
		discardTimer = setTimeout(() => {
			pendingDiscard = null;
			discardTimer = null;
		}, DISCARD_UNDO_MS);

		text = '';
		clearPhoto();
		clearDraft(DRAFT_ID);
		closeSheet();
	}

	function undoDiscard() {
		if (!pendingDiscard) return;
		if (discardTimer) clearTimeout(discardTimer);
		discardTimer = null;

		text = pendingDiscard.text;
		photoDataUrl = pendingDiscard.photoDataUrl;
		selected = pendingDiscard.selected;
		pendingDiscard = null;

		if (!desktop) open = true;
		queueMicrotask(() => textarea?.focus());
	}

	function pickPhoto() {
		photoInput?.click();
	}

	function onPhotoChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		photoTooLarge = file.size > MAX_PHOTO_BYTES;
		if (photoTooLarge) return;

		const reader = new FileReader();
		reader.onload = () => {
			photoDataUrl = reader.result as string;
			textarea?.focus();
		};
		reader.readAsDataURL(file);
	}

	function clearPhoto() {
		photoDataUrl = null;
		photoTooLarge = false;
	}

	function buildContent(): string {
		const parts: string[] = [];
		if (photoDataUrl) parts.push(`![](${photoDataUrl})`);
		const t = text.trim();
		if (t) parts.push(t);
		return parts.join('\n\n');
	}

	function save() {
		const content = buildContent();
		if (!content) return;

		const entry = queueNote({
			title: '',
			content_markdown: content,
			source_url: null,
			source_type: null,
			source_title: null,
			source_description: null,
			source_image: null,
			parent_id: continuation.target?.id ?? null,
			tagNames: selected.map(normalizeTagName).filter(Boolean)
		});

		// Still in the same thread afterwards: three thoughts in a row are one
		// train of thought, not three separate decisions.
		touch();

		// Show it in the stream now. The POST is already on its way and the
		// entry is durable in localStorage either way, so there is nothing
		// worth making the reader wait for.
		addPending(entry);

		text = '';
		clearPhoto();
		clearDraft(DRAFT_ID);
		closeSheet();

		// The dock doesn't go anywhere when you keep a thought, so the next
		// thing you'd do is write the next one — leave the caret where it was
		// rather than making you click back into an empty box.
		if (desktop) queueMicrotask(() => textarea?.focus());

		syncEntry(
			entry,
			async (id) => {
				// It's real as soon as the POST answers: give the local copy the
				// server's id so it stops reading as pending and can be opened,
				// rather than staying greyed out for the length of the refetch.
				settlePending(entry.client_id, id);
				// Reload first, then drop the local copy — doing it the other way
				// round blinks the note out of the list for a frame.
				await invalidateAll();
				removePending(entry.client_id);
			},
			() => showToast('Saved on this device — will sync', { duration: 2600 })
		);
	}

	/* ---------------- voice ---------------- */

	type SpeechCtor = new () => any;

	function speechCtor(): SpeechCtor | null {
		if (typeof window === 'undefined') return null;
		return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
	}

	let recognition: any = null;
	let timer: ReturnType<typeof setInterval> | null = null;

	function startRecording() {
		const Ctor = speechCtor();
		if (!Ctor) {
			// No on-device recognition here — fall back to the keyboard rather
			// than pretending to record something we can't turn into a thought.
			voiceError = 'Voice capture needs Chrome or Safari on this device.';
			openSheet();
			return;
		}

		selected = contextTag ? [contextTag] : [];
		interim = '';
		seconds = 0;
		recording = true;
		timer = setInterval(() => seconds++, 1000);

		recognition = new Ctor();
		recognition.continuous = true;
		recognition.interimResults = true;
		recognition.lang = navigator.language || 'en-US';

		let settled = '';
		recognition.onresult = (event: any) => {
			let pending = '';
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const result = event.results[i];
				if (result.isFinal) settled += result[0].transcript;
				else pending += result[0].transcript;
			}
			interim = (settled + pending).trim();
		};
		recognition.onerror = () => stopRecording(true);
		recognition.onend = () => {
			if (recording) stopRecording();
		};

		try {
			recognition.start();
		} catch {
			stopRecording(true);
		}
	}

	function stopRecording(cancelled = false) {
		recording = false;
		if (timer) clearInterval(timer);
		timer = null;
		try {
			recognition?.stop();
		} catch {
			/* already stopped */
		}
		recognition = null;

		const captured = interim.trim();
		interim = '';
		if (cancelled || !captured) return;

		text = captured;
		save();
	}

	function cancelRecording() {
		interim = '';
		stopRecording(true);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			// Cmd/Ctrl+Enter always saves, wherever you are.
			if (event.metaKey || event.ctrlKey) {
				event.preventDefault();
				save();
				return;
			}
			// A touch keyboard has no Shift+Enter, so making Enter submit there
			// means you simply cannot write a second paragraph. On touch it's a
			// newline and the green button is how you save; a hardware keyboard
			// keeps Enter-to-save with Shift+Enter for a newline.
			const touch = window.matchMedia('(pointer: coarse)').matches;
			if (!touch && !event.shiftKey) {
				event.preventDefault();
				save();
			}
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			// There is no sheet to dismiss on desktop — Escape steps out of the
			// dock and hands the page back to the keyboard.
			if (desktop) textarea?.blur();
			else dismiss();
		}
	}

	let clock = $derived(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
</script>

<!-- ---------------- collapsed bar (phone only) ----------------
     Hidden by CSS rather than by `desktop`, so a wide window never paints
     a floating write-bar for the frame before hydration decides. -->
<div
	class="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center px-[18px] pt-10 lg:hidden"
	style="background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--color-bg) 90%, transparent) 42%, var(--color-bg) 68%); padding-bottom: calc(1.75rem + env(safe-area-inset-bottom));"
	class:opacity-0={open || recording}
>
	<div class="flex w-full max-w-2xl flex-col gap-2">
		<!-- You are in a thread. This is the only thing on screen that says so
		     while the sheet is closed, so it sits directly above the bar you're
		     about to type into and carries its own way out. -->
		{#if target}
			<div class="flex" transition:fly={{ y: 8, duration: 180 }}>
				<div
					class="pointer-events-auto flex min-w-0 items-center gap-1.5 rounded-full py-1.5 pr-1.5 pl-3"
					style="background: var(--color-accent-soft);"
				>
					<span class="shrink-0 text-[0.8rem] leading-none" style="color: var(--color-accent);"
						>&#8627;</span
					>
					<button
						type="button"
						class="min-w-0 truncate text-[0.78rem] font-bold tracking-[-0.015em]"
						style="color: var(--color-accent);"
						onclick={openSheet}
					>
						{barLabel}
					</button>
					<button
						type="button"
						aria-label="Stop adding to this thought"
						class="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[0.62rem] active:scale-90"
						style="background: color-mix(in srgb, var(--color-accent) 16%, transparent); color: var(--color-accent);"
						onclick={detach}
					>
						&#10005;
					</button>
				</div>
			</div>
		{/if}

		<div class="flex items-center gap-2">
			<div
				class="pointer-events-auto flex h-[62px] flex-1 cursor-text touch-manipulation items-center rounded-[22px] pr-2 pl-[22px]"
				style="background: var(--color-accent); color: var(--color-accent-ink); box-shadow: 0 10px 26px rgba(20,80,58,.26);"
				onclick={openSheet}
				onkeydown={(e) => e.key === 'Enter' && openSheet()}
				role="button"
				tabindex="0"
			>
				<span class="flex-1 truncate text-[1.05rem] font-bold tracking-[-0.02em] opacity-95">
					{#if target}
						Add to this thought…
					{:else if contextTag}
						Write in #{contextTag}…
					{:else}
						Write something…
					{/if}
				</span>
				<button
					type="button"
					aria-label="Record a thought"
					class="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[14px] active:scale-95"
					style="background: rgba(255,255,255,.16); color: var(--color-accent-ink);"
					onclick={(e) => {
						e.stopPropagation();
						startRecording();
					}}
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						><rect x="9" y="3" width="6" height="11" rx="3" /><path
							d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
						/></svg
					>
				</button>
			</div>

			<button
				type="button"
				aria-label="Search and filter"
				class="pointer-events-auto grid h-[62px] w-[62px] shrink-0 place-items-center rounded-[22px] active:scale-95"
				style="background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: 0 3px 12px rgba(0,0,0,.055); color: var(--color-ink-2);"
				onclick={search}
			>
				<svg
					width="22"
					height="22"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg
				>
			</button>
		</div>
	</div>
</div>

<!-- ---------------- recording ---------------- -->
{#if recording}
	<div
		class="safe-bottom fixed inset-x-[18px] bottom-5 z-30 mx-auto flex max-w-2xl items-center gap-3 rounded-[0.88rem] px-4 py-3"
		style="background: var(--color-accent); color: var(--color-accent-ink);"
	>
		<span class="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full" style="background: #ff7b7b;"
		></span>
		<span class="shrink-0 text-[0.85rem] font-medium tabular-nums">{clock}</span>
		<span class="min-w-0 flex-1 truncate text-[0.85rem] opacity-80">{interim || 'Listening…'}</span>
		<button
			type="button"
			class="shrink-0 rounded-[0.56rem] px-3 py-1.5 text-[0.8rem] font-semibold"
			style="background: rgba(255,255,255,.18);"
			onclick={() => stopRecording()}>Keep</button
		>
		<button
			type="button"
			aria-label="Cancel"
			class="shrink-0 px-1 text-[0.9rem] opacity-60"
			onclick={cancelRecording}>✕</button
		>
	</div>
{/if}

<!-- ---------------- discard undo ---------------- -->
{#if pendingDiscard}
	<div
		class="safe-bottom pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center px-[18px]"
	>
		{#key pendingDiscard}
			<div
				class="pointer-events-auto overflow-hidden rounded-full"
				style="background: var(--color-ink); color: var(--color-bg); box-shadow: 0 8px 20px rgba(0,0,0,.18);"
				transition:fly={{ y: 10, duration: 180 }}
			>
				<div class="flex items-center gap-3 py-2 pr-2 pl-4">
					<span class="min-w-0 truncate text-[0.82rem] font-medium" in:fade={{ duration: 140 }}
						>Discarded</span
					>
					<button
						type="button"
						class="shrink-0 rounded-full px-3 py-1.5 text-[0.8rem] font-semibold"
						style="background: rgba(255,255,255,.18);"
						onclick={undoDiscard}
					>
						Undo
					</button>
				</div>
				<div class="h-[3px] w-full" style="background: rgba(255,255,255,.18);">
					<div
						class="h-full"
						style="background: var(--color-accent); animation: discard-progress {DISCARD_UNDO_MS}ms linear forwards;"
					></div>
				</div>
			</div>
		{/key}
	</div>
{/if}

<!-- ---------------- the composer itself ----------------
	 One body, two frames around it: a modal sheet over the stream on a
	 phone, a bar docked to the bottom of it on a desktop. Keeping it a
	 snippet is what makes the two genuinely the same composer rather than
	 two that drift.
-->
{#snippet composeBody(desktopMode: boolean)}
	{#if voiceError}
		<p class="mb-2 shrink-0 text-[0.78rem]" style="color: var(--color-ink-muted);">
			{voiceError}
		</p>
	{/if}

	<!-- The thread you're adding to, with its own way out. Shown only when
		     you arrived here from that thought's "+"; writing from scratch
		     starts on an empty box. -->
	{#if target}
		<div
			class="mb-2.5 flex shrink-0 items-center gap-2 rounded-[14px] py-1.5 pr-1.5 pl-2.5"
			style="background: var(--color-accent-soft);"
		>
			<span class="shrink-0 text-[0.85rem] leading-none" style="color: var(--color-accent);"
				>&#8627;</span
			>
			{#if target.image}
				<img
					src={target.image}
					alt=""
					class="h-7 w-7 shrink-0 rounded-[8px] object-cover"
					style="background: var(--color-surface-2);"
				/>
			{/if}
			<span
				class="min-w-0 flex-1 truncate text-[0.8rem] font-bold tracking-[-0.015em]"
				style="color: var(--color-accent);"
			>
				{target.label}
			</span>
			<button
				type="button"
				aria-label="Write on its own instead"
				class="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.68rem] active:scale-90"
				style="background: color-mix(in srgb, var(--color-accent) 16%, transparent); color: var(--color-accent);"
				onclick={detach}
			>
				&#10005;
			</button>
		</div>
	{/if}

	<div class="mb-3 shrink-0">
		<TagPicker bind:selected recent={recentTags} onpick={() => textarea?.focus()} />
	</div>

	{#if photoDataUrl}
		<div class="relative mb-3 inline-block shrink-0">
			<img
				src={photoDataUrl}
				alt=""
				class="h-20 w-20 rounded-[var(--radius-lg)] object-cover"
				style="background: var(--color-surface-2);"
			/>
			<button
				type="button"
				aria-label="Remove photo"
				class="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full text-[10px]"
				style="background: var(--color-ink); color: var(--color-bg);"
				onclick={clearPhoto}
			>
				✕
			</button>
		</div>
	{/if}
	{#if photoTooLarge}
		<p class="mb-2 shrink-0 text-[0.78rem]" style="color: var(--color-danger);">
			That photo's too large to attach right now (4MB max).
		</p>
	{/if}

	<!-- The sheet opens as an explicit "now I'm writing" gesture, so it can
		     afford to invite four lines right away. The dock is sitting over
		     the stream at all times, the way Claude's and Gemini's message box
		     do — it starts at one line and grows with what you type, via the
		     `field-sizing: content` every textarea in this app already gets
		     (layout.css), capped so a long thought scrolls instead of pushing
		     the stream underneath it off the bottom of the window. -->
	<textarea
		bind:this={textarea}
		bind:value={text}
		onkeydown={onKeydown}
		rows={desktopMode ? 1 : 4}
		placeholder="Write something…"
		style="outline: none;"
		class={desktopMode
			? 'max-h-[38vh] w-full flex-none resize-none overflow-y-auto bg-transparent font-serif text-[1.06rem] leading-[1.44] tracking-[-0.017em] outline-none'
			: 'min-h-[calc(1.06rem*1.44*4)] w-full flex-auto resize-none overflow-y-auto bg-transparent font-serif text-[1.06rem] leading-[1.44] tracking-[-0.017em] outline-none'}
	></textarea>

	<div class="mt-2 flex shrink-0 items-center gap-2">
		<button
			type="button"
			aria-label="Photo"
			class="grid h-9 w-9 shrink-0 place-items-center rounded-full"
			style="background: var(--color-surface-2); color: var(--color-ink-2);"
			onclick={pickPhoto}
		>
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.9"
				stroke-linecap="round"
				stroke-linejoin="round"
				><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="8.5" cy="9.5" r="1.5" /><path
					d="M3 16l5-4 4 3 3-2 6 4"
				/></svg
			>
		</button>
		<input
			bind:this={photoInput}
			type="file"
			accept="image/*"
			class="hidden"
			onchange={onPhotoChosen}
		/>

		<button
			type="button"
			aria-label="Voice"
			class="grid h-9 w-9 shrink-0 place-items-center rounded-full"
			style="background: var(--color-surface-2); color: var(--color-ink-2);"
			onclick={() => {
				closeSheet();
				startRecording();
			}}
		>
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.9"
				stroke-linecap="round"
				><rect x="9" y="3" width="6" height="11" rx="3" /><path
					d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
				/></svg
			>
		</button>

		<!-- Nothing to expand into when the composer is already a
			     full-height column. -->
		{#if !desktopMode}
			<button
				type="button"
				aria-label="Full screen"
				disabled
				class="grid h-9 w-9 shrink-0 cursor-default place-items-center rounded-full opacity-35"
				style="background: var(--color-surface-2); color: var(--color-ink-2);"
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.9"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" /></svg
				>
			</button>
		{/if}

		{#if hasContent}
			<button
				type="button"
				aria-label="Discard"
				class="grid h-9 w-9 shrink-0 place-items-center rounded-full"
				style="background: var(--color-danger-soft); color: var(--color-danger);"
				onclick={discard}
				transition:scale={{ duration: 180, start: 0.5, easing: quintOut }}
			>
				<svg
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.9"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg
				>
			</button>
		{/if}

		<span class="flex-1"></span>

		<button
			type="button"
			aria-label={hasContent ? 'Keep' : 'Record'}
			class="grid h-[2.875rem] w-[2.875rem] shrink-0 place-items-center rounded-full active:scale-95"
			style="background: var(--color-accent); color: var(--color-accent-ink);"
			onclick={() => (hasContent ? save() : (closeSheet(), startRecording()))}
		>
			{#if hasContent}
				<svg
					width="19"
					height="19"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.4"
					stroke-linecap="round"
					stroke-linejoin="round"
					in:scale={{ duration: 180, start: 0.5, easing: quintOut }}
					><path d="m5 12.5 4.5 4.5L19 7.5" /></svg
				>
			{:else}
				<svg
					width="19"
					height="19"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					in:scale={{ duration: 180, start: 0.5, easing: quintOut }}
					><rect x="9" y="3" width="6" height="11" rx="3" /><path
						d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
					/></svg
				>
			{/if}
		</button>
	</div>
{/snippet}

<!-- ---------------- phone: a sheet over the stream ---------------- -->
{#if open && !desktop}
	<div
		class="fixed inset-0 z-30 touch-manipulation lg:hidden"
		style="background: rgba(14,14,10,.38);"
		onclick={dismiss}
		onkeydown={(e) => e.key === 'Escape' && dismiss()}
		role="button"
		tabindex="-1"
		aria-label="Close composer"
		transition:fade={{ duration: 200 }}
	></div>

	<div
		class="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[80vh] max-w-2xl flex-col rounded-t-[1.375rem] px-[1.125rem] pt-[0.625rem] lg:hidden"
		style="background: var(--color-surface); box-shadow: 0 -8px 34px rgba(0,0,0,.16); padding-bottom: calc(0.25rem + env(safe-area-inset-bottom));"
		transition:fly={{ y: 420, duration: 320, easing: quintOut }}
	>
		<div
			class="mx-auto mb-3 h-1 w-9 shrink-0 rounded-full"
			style="background: var(--color-border);"
		></div>

		{@render composeBody(false)}
	</div>
{/if}

<!-- ---------------- desktop: a bar docked over the stream ----------------
	 The Claude/Gemini move: not a modal, not a sidebar — a bar that's simply
	 always there at the bottom of the column, sitting over the last inch of
	 the stream rather than taking a slice of the window permanently. Always
	 mounted, so there's no "start writing" step; it just grows as you type.
-->
{#if desktop}
	<div
		class="pointer-events-none fixed inset-x-0 bottom-0 z-20 hidden justify-center px-[18px] pb-8 lg:pb-0 lg:flex"
		class:opacity-0={recording}
	>
		<div
			class="pointer-events-auto flex w-full max-w-2xl flex-col rounded-[1.375rem] px-[1.125rem] pt-[0.625rem] pb-3"
			style="background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: 0 12px 34px rgba(0,0,0,.12);"
		>
			{@render composeBody(true)}
		</div>
	</div>
{/if}

<style>
	@keyframes discard-progress {
		from {
			width: 100%;
		}
		to {
			width: 0%;
		}
	}
</style>
