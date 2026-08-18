<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { queueNote, syncEntry } from '$lib/outbox';
	import { normalizeTagName } from '$lib/tags';
	import { showToast } from '$lib/toast.svelte';
	import type { Tag } from '$lib/types';
	import { fly, fade, scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	let { recentTags = [], contextTag = null }: { recentTags?: Tag[]; contextTag?: string | null } =
		$props();

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

	let suggestions = $derived.by(() => {
		const names = recentTags.map((t) => t.name);
		for (const name of selected) if (!names.includes(name)) names.push(name);
		return names.slice(0, 8);
	});

	function openSheet() {
		selected = contextTag ? [contextTag] : [];
		voiceError = '';
		clearPhoto();
		open = true;
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

		open = true;
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

	function toggleTag(name: string, event?: MouseEvent) {
		selected = selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name];
		textarea?.focus();

		(event?.currentTarget as HTMLElement | undefined)?.animate(
			[{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }],
			{ duration: 240, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
		);
	}

	let addingTag = $state(false);
	let newTagInput = $state('');
	let newTagInputEl = $state<HTMLInputElement | null>(null);

	function startNewTag() {
		addingTag = true;
		queueMicrotask(() => newTagInputEl?.focus());
	}

	function commitNewTag() {
		const name = normalizeTagName(newTagInput);
		if (name && !selected.includes(name)) selected = [...selected, name];
		newTagInput = '';
		addingTag = false;
		textarea?.focus();
	}

	function cancelNewTag() {
		newTagInput = '';
		addingTag = false;
		textarea?.focus();
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
			tagNames: selected.map(normalizeTagName).filter(Boolean)
		});

		text = '';
		clearPhoto();
		closeSheet();
		showToast('Saving…', { then: 'Saved' });
		syncEntry(entry, () => invalidateAll());
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
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			save();
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			dismiss();
		}
	}

	let clock = $derived(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
</script>

<!-- ---------------- collapsed bar ---------------- -->
<div
	class="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex items-center gap-2 px-[18px] pt-10"
	style="background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--color-bg) 90%, transparent) 42%, var(--color-bg) 68%); padding-bottom: calc(1.75rem + env(safe-area-inset-bottom));"
	class:opacity-0={open || recording}
>
	<div
		class="pointer-events-auto flex h-[54px] flex-1 cursor-text touch-manipulation items-center rounded-[1.1rem] pr-1.5 pl-[22px]"
		style="background: var(--color-accent); color: var(--color-accent-ink); box-shadow: 0 8px 22px rgba(20,80,58,.26);"
		onclick={openSheet}
		onkeydown={(e) => e.key === 'Enter' && openSheet()}
		role="button"
		tabindex="0"
	>
		<span class="flex-1 text-[0.97rem] font-medium opacity-95">
			{contextTag ? `Write in #${contextTag}…` : 'Write something…'}
		</span>
		<button
			type="button"
			aria-label="Record a thought"
			class="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[0.7rem] active:scale-95"
			style="background: rgba(255,255,255,.16); color: var(--color-accent-ink);"
			onclick={(e) => {
				e.stopPropagation();
				startRecording();
			}}
		>
			<svg
				width="17"
				height="17"
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

	<a
		href="/search"
		aria-label="Search"
		class="pointer-events-auto grid h-[54px] w-[54px] shrink-0 place-items-center rounded-[1.1rem]"
		style="background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: 0 3px 12px rgba(0,0,0,.055); color: var(--color-ink-2);"
	>
		<svg
			width="19"
			height="19"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg
		>
	</a>
</div>

<!-- ---------------- recording ---------------- -->
{#if recording}
	<div
		class="safe-bottom fixed inset-x-[18px] bottom-5 z-30 flex items-center gap-3 rounded-[0.88rem] px-4 py-3"
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

<!-- ---------------- sheet ---------------- -->
{#if open}
	<div
		class="fixed inset-0 z-30 touch-manipulation"
		style="background: rgba(14,14,10,.38);"
		onclick={dismiss}
		onkeydown={(e) => e.key === 'Escape' && dismiss()}
		role="button"
		tabindex="-1"
		aria-label="Close composer"
		transition:fade={{ duration: 200 }}
	></div>

	<div
		class="fixed inset-x-0 bottom-0 z-40 flex max-h-[80vh] flex-col rounded-t-[1.375rem] px-[1.125rem] pt-[0.625rem]"
		style="background: var(--color-surface); box-shadow: 0 -8px 34px rgba(0,0,0,.16); padding-bottom: calc(1.125rem + env(safe-area-inset-bottom));"
		transition:fly={{ y: 420, duration: 320, easing: quintOut }}
	>
		<div
			class="mx-auto mb-3 h-1 w-9 shrink-0 rounded-full"
			style="background: var(--color-border);"
		></div>

		{#if voiceError}
			<p class="mb-2 shrink-0 text-[0.78rem]" style="color: var(--color-ink-muted);">
				{voiceError}
			</p>
		{/if}

		<!-- Tags sit above the text, styled as pills: dashed and quiet until
		     picked, filled once they're on — mirrors the destination affordance
		     from the flat-stream prototype. "+ New" is pinned first so it's
		     always reachable regardless of how far the row scrolls. -->
		<div class="mb-3 flex shrink-0 items-center gap-1.5">
			{#if addingTag}
				<input
					bind:this={newTagInputEl}
					bind:value={newTagInput}
					type="text"
					placeholder="Tag name"
					class="min-h-8 w-28 shrink-0 rounded-full border border-dashed px-3 py-1.5 text-[0.8rem] font-medium outline-none"
					style="border-color: var(--color-border); color: var(--color-ink); background: none;"
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							commitNewTag();
						}
						if (e.key === 'Escape') {
							e.preventDefault();
							cancelNewTag();
						}
					}}
					onblur={commitNewTag}
				/>
			{:else}
				<button
					type="button"
					class="min-h-8 shrink-0 rounded-full border border-dashed px-3 py-1.5 text-[0.8125rem] font-medium whitespace-nowrap active:scale-95"
					style="border-color: var(--color-border); color: var(--color-ink-muted);"
					onclick={startNewTag}
				>
					+ New
				</button>
			{/if}

			<div class="relative min-w-0 flex-1">
				<div class="flex items-center gap-1.5 overflow-x-auto pr-6" style="scrollbar-width: none;">
					{#each suggestions as name (name)}
						{@const on = selected.includes(name)}
						<button
							type="button"
							class="min-h-8 shrink-0 rounded-full border px-3 py-1.5 text-[0.8rem] font-medium whitespace-nowrap active:scale-95"
							class:border-dashed={!on}
							style={on
								? 'border-color: transparent; background: var(--color-accent-soft); color: var(--color-accent); font-weight: 620;'
								: 'border-color: var(--color-border); color: var(--color-ink-muted); background: none;'}
							aria-pressed={on}
							onclick={(e) => toggleTag(name, e)}
						>
							#{name}{#if on}<span class="ml-1 opacity-50">✕</span>{/if}
						</button>
					{/each}
				</div>
				<div
					class="pointer-events-none absolute inset-y-0 right-0 w-8"
					style="background: linear-gradient(to right, transparent, var(--color-surface));"
				></div>
			</div>
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

		<textarea
			bind:this={textarea}
			bind:value={text}
			onkeydown={onKeydown}
			rows="4"
			placeholder="Write something…"
			class="min-h-[calc(1.06rem*1.44*4)] w-full flex-auto resize-none overflow-y-auto bg-transparent text-[1.06rem] leading-[1.44] tracking-[-0.017em] outline-none"
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
					><rect x="3" y="4" width="18" height="16" rx="3" /><circle
						cx="8.5"
						cy="9.5"
						r="1.5"
					/><path d="M3 16l5-4 4 3 3-2 6 4" /></svg
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
