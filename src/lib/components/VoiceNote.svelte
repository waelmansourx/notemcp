<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { VoiceNote as VoiceNoteData } from '$lib/types';

	let {
		noteId,
		voice,
		href = null,
		class: className = '',
		ontranscript,
		onopen
	}: {
		noteId: string;
		voice: VoiceNoteData;
		href?: string | null;
		class?: string;
		ontranscript?: (text: string) => void;
		onopen?: () => void;
	} = $props();

	let polled = $state<VoiceNoteData | null>(null);
	let current = $derived(polled ?? voice);
	let audio = $state<HTMLAudioElement | null>(null);
	let playing = $state(false);
	let elapsed = $state(0);
	let retrying = $state(false);

	$effect(() => {
		polled = voice;
	});

	$effect(() => {
		const status = current.transcription_status;
		if (noteId.startsWith('pending:') || (status !== 'pending' && status !== 'processing')) {
			return;
		}

		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const poll = async () => {
			try {
				const response = await fetch(`/api/notes/${noteId}/transcription`);
				if (!response.ok || cancelled) return;
				const next = (await response.json()) as VoiceNoteData;
				polled = next;
				if (next.transcription_status === 'complete') {
					if (next.raw_text) ontranscript?.(next.raw_text);
					await invalidateAll();
					return;
				}
				if (next.transcription_status === 'failed') return;
			} catch {
				// A flaky read does not change the provider job. Poll again.
			}
			if (!cancelled) timer = setTimeout(poll, 4_000);
		};
		timer = setTimeout(poll, 2_500);

		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	});

	let source = $derived(
		current.local_url || (current.media_id ? `/api/media/${current.media_id}` : null)
	);
	let duration = $derived(Math.max(0, current.duration_ms / 1_000));
	let clock = $derived(formatTime(playing ? elapsed : duration));
	let progress = $derived(duration > 0 ? Math.min(1, elapsed / duration) : 0);
	let bars = $derived(
		current.waveform.length > 0
			? current.waveform
			: [22, 36, 28, 48, 34, 58, 42, 66, 38, 54, 30, 46, 26, 40, 22, 34]
	);

	function formatTime(value: number): string {
		const seconds = Math.max(0, Math.round(value));
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}

	async function toggle() {
		if (!audio || !source) return;
		if (audio.paused) await audio.play().catch(() => {});
		else audio.pause();
	}

	function seek(event: MouseEvent) {
		if (!audio || duration <= 0) return;
		const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
		audio.currentTime =
			Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * duration;
		elapsed = audio.currentTime;
	}

	async function retry() {
		if (retrying || noteId.startsWith('pending:')) return;
		retrying = true;
		try {
			const response = await fetch(`/api/notes/${noteId}/transcription`, { method: 'POST' });
			if (response.ok) {
				polled = { ...current, transcription_status: 'processing', error: null };
			}
		} finally {
			retrying = false;
		}
	}
</script>

<div
	class="flex min-w-0 items-center gap-2.5 rounded-[12px] px-2.5 py-2 {className}"
	style="background: var(--color-surface-2);"
>
	<audio
		bind:this={audio}
		class="hidden"
		src={source ?? undefined}
		preload="metadata"
		onplay={() => (playing = true)}
		onpause={() => (playing = false)}
		onended={() => {
			playing = false;
			elapsed = 0;
		}}
		ontimeupdate={() => (elapsed = audio?.currentTime ?? 0)}
	></audio>

	<button
		type="button"
		disabled={!source}
		aria-label={playing ? 'Pause voice note' : 'Play voice note'}
		class="grid h-8 w-8 shrink-0 place-items-center rounded-full disabled:opacity-40"
		style="background: var(--color-accent); color: var(--color-accent-ink);"
		onclick={toggle}
	>
		{#if playing}
			<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
				<rect x="2" y="1.5" width="3" height="9" rx="0.8" />
				<rect x="7" y="1.5" width="3" height="9" rx="0.8" />
			</svg>
		{:else}
			<svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
				<path d="M3 1.7a.8.8 0 0 1 1.2-.68l6 4.3a.84.84 0 0 1 0 1.36l-6 4.3A.8.8 0 0 1 3 10.3Z" />
			</svg>
		{/if}
	</button>

	<div class="min-w-0 flex-1">
		<button
			type="button"
			aria-label="Seek voice note"
			class="flex h-5 w-full items-center gap-[2px]"
			onclick={seek}
		>
			{#each bars as level, index (index)}
				<span
					class="min-w-[2px] flex-1 rounded-full"
					style="height: {Math.max(
						3,
						Math.round((Math.min(100, Math.max(0, level)) / 100) * 18)
					)}px; background: {index / bars.length <= progress
						? 'var(--color-accent)'
						: 'var(--color-border)'};"
				></span>
			{/each}
		</button>

		<div class="mt-0.5 flex min-w-0 items-center gap-2 text-[0.67rem] font-semibold">
			<span class="tabular-nums" style="color: var(--color-ink-muted);">{clock}</span>
			<span class="min-w-0 flex-1 truncate" style="color: var(--color-ink-faint);">
				{#if current.transcription_status === 'complete'}
					{#if onopen}
						<button type="button" onclick={onopen}>Transcribed</button>
					{:else if href}
						<a {href}>Transcribed</a>
					{:else}
						Transcribed
					{/if}
				{:else if current.transcription_status === 'failed'}
					Transcription failed
				{:else if noteId.startsWith('pending:')}
					Saved locally · uploading…
				{:else}
					{#if onopen}
						<button type="button" onclick={onopen}>Transcribing…</button>
					{:else if href}
						<a {href}>Transcribing…</a>
					{:else}
						Transcribing…
					{/if}
				{/if}
			</span>
			{#if current.transcription_status === 'failed' && !noteId.startsWith('pending:')}
				<button
					type="button"
					disabled={retrying}
					class="shrink-0 font-bold disabled:opacity-50"
					style="color: var(--color-accent);"
					onclick={retry}>{retrying ? 'Retrying…' : 'Retry'}</button
				>
			{/if}
		</div>
	</div>
</div>
