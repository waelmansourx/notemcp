<script lang="ts">
	import type { Note } from '$lib/types';
	import { timeOfDay, hostname, streamDate, relativeTime } from '$lib/dates';
	import { firstLine, snippet, excerpt, extractLeadingImage } from '$lib/markdown';
	import { isPending } from '$lib/stream.svelte';
	import { lastActivity, stubOf } from '$lib/thread';
	import { writeInto } from '$lib/composer.svelte';
	import { keepSelection } from '$lib/selection';
	import TagChip from './TagChip.svelte';
	import Thought from './Thought.svelte';
	import VoiceNote from './VoiceNote.svelte';

	let { note, showTime = false }: { note: Note; showTime?: boolean } = $props();

	let isLink = $derived(Boolean(note.source_url));
	let { image: embeddedImage, rest: textOnly } = $derived(
		extractLeadingImage(note.content_markdown)
	);
	let hasEmbeddedImage = $derived(!isLink && Boolean(embeddedImage));
	let heading = $derived(note.source_title?.trim() || note.title.trim() || '');
	let caption = $derived(snippet(note.content_markdown));
	let voice = $derived(note.voice_note ?? null);
	let body = $derived(excerpt(textOnly) || firstLine(note.title) || (voice ? '' : 'Untitled'));
	let queued = $derived(isPending(note));
	let thoughts = $derived(note.children ?? []);
	let expanded = $state(false);
</script>

<div class="entry py-4" style={queued ? 'opacity: 0.5;' : ''} aria-busy={queued || undefined}>
	{#if voice}
		<VoiceNote
			noteId={note.id}
			{voice}
			href={queued ? null : `/note/${note.id}`}
			class={body ? 'mb-3' : ''}
		/>
	{/if}

	{#if !voice || body || isLink || hasEmbeddedImage}
		<a
			href={queued ? undefined : `/note/${note.id}`}
			onclick={keepSelection}
			class="block active:opacity-65"
			aria-label={heading || firstLine(note.content_markdown) || (voice ? 'Voice note' : 'Note')}
			style={queued ? '' : `view-transition-name: note-${note.id};`}
		>
			{#if isLink}
				{#if caption}
					<p class="font-serif text-[1.12rem] leading-[1.5] tracking-[-0.01em]">
						{caption}
					</p>
				{/if}

				<div
					class="mt-3 flex items-center gap-3 rounded-[10px] px-3 py-2.5"
					style="background: var(--color-surface);"
				>
					{#if note.source_image}
						<img
							src={note.source_image}
							alt=""
							loading="lazy"
							class="h-[46px] w-[46px] shrink-0 rounded-[5px] object-cover"
							style="background: var(--color-surface-2);"
						/>
					{:else}
						<span
							class="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[5px] font-serif text-[1rem]"
							style="background: var(--color-surface-2); color: var(--color-ink-faint);"
							aria-hidden="true"
						>
							↗
						</span>
					{/if}

					<span class="min-w-0 flex-1">
						{#if heading}
							<span
								class="block truncate text-[0.76rem] font-semibold"
								style="color: var(--color-ink-2);"
							>
								{heading}
							</span>
						{/if}
						{#if note.source_description}
							<span
								class="mt-1 block truncate text-[0.72rem] leading-[1.35]"
								style="color: var(--color-ink-faint);"
							>
								{note.source_description}
							</span>
						{/if}
					</span>
					<span
						class="shrink-0 text-[0.58rem] font-semibold tracking-[0.1em] uppercase"
						style="color: var(--color-ink-faint);"
					>
						{note.source_type || 'link'}
					</span>
				</div>
			{:else if hasEmbeddedImage}
				<div class="flex items-start gap-4">
					<img
						src={embeddedImage}
						alt=""
						loading="lazy"
						class="h-[72px] w-[72px] shrink-0 rounded-[12px] object-cover"
						style="background: var(--color-surface-2);"
					/>
					{#if textOnly.trim()}
						<p
							class="line-clamp-3 min-w-0 flex-1 font-serif text-[1.12rem] leading-[1.5] tracking-[-0.01em] whitespace-pre-wrap"
						>
							{excerpt(textOnly, 200)}
						</p>
					{/if}
				</div>
			{:else if body}
				<p
					class="line-clamp-6 font-serif text-[1.12rem] leading-[1.5] tracking-[-0.01em] whitespace-pre-wrap"
				>
					{body}
				</p>
			{/if}
		</a>
	{/if}

	<div
		class="mt-3 flex items-center gap-2.5 text-[0.72rem] font-medium tracking-[-0.01em]"
		style="color: var(--color-ink-faint);"
	>
		{#each note.tags as tag (tag.id)}
			<TagChip {tag} />
		{/each}
		<span class="flex-1"></span>
		{#if isLink && note.source_url}
			<span class="max-w-[9rem] truncate" style="color: var(--color-ink-muted);"
				>{hostname(note.source_url)}</span
			>
		{/if}
		{#if showTime}
			{#if isLink}<span aria-hidden="true">·</span>{/if}
			<span class="whitespace-nowrap tabular-nums">{timeOfDay(streamDate(note))}</span>
		{/if}
		{#if !queued}
			<button
				type="button"
				aria-label="Add a thought to this"
				class="-my-1 grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full active:scale-90"
				style="color: var(--color-accent);"
				onclick={() => writeInto(stubOf(note))}
			>
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.7"
					stroke-linecap="round"
				>
					<path d="M12 5v14M5 12h14" />
				</svg>
			</button>
		{/if}
	</div>

	{#if thoughts.length > 0}
		<button
			type="button"
			class="mt-2.5 flex items-center gap-1.5 text-[0.7rem] font-semibold tracking-[-0.01em] active:opacity-60"
			style="color: var(--color-accent);"
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}
		>
			<svg
				width="10"
				height="10"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="3.2"
				stroke-linecap="round"
				stroke-linejoin="round"
				style="transition: transform 180ms ease; transform: rotate({expanded ? 90 : 0}deg);"
			>
				<path d="m9 5 7 7-7 7" />
			</svg>
			{thoughts.length} more
			<span style="color: var(--color-ink-faint);">· {relativeTime(lastActivity(note))}</span>
		</button>

		{#if expanded}
			<div class="mt-4 space-y-5">
				{#each thoughts as thought (thought.id)}
					<Thought
						note={thought}
						href={isPending(thought) ? null : `/note/${thought.id}`}
						max={240}
					/>
				{/each}
			</div>
		{/if}
	{/if}
</div>
