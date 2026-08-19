<script lang="ts">
	import type { Note } from '$lib/types';
	import { timeOfDay, hostname, streamDate, relativeTime } from '$lib/dates';
	import { firstLine, snippet, excerpt, extractLeadingImage } from '$lib/markdown';
	import { isPending } from '$lib/stream.svelte';
	import { lastActivity, stubOf } from '$lib/thread';
	import { writeInto } from '$lib/composer.svelte';
	import TagChip from './TagChip.svelte';
	import Thought from './Thought.svelte';

	let { note, showTime = false }: { note: Note; showTime?: boolean } = $props();

	// A shared link reads as a headline + your own caption. A typed thought is
	// just the text — no title field, because being asked to name an idea is
	// the thing that stops you writing it down.
	let isLink = $derived(Boolean(note.source_url));
	let { image: embeddedImage, rest: textOnly } = $derived(
		extractLeadingImage(note.content_markdown)
	);
	let hasEmbeddedImage = $derived(!isLink && Boolean(embeddedImage));
	let heading = $derived(note.source_title?.trim() || note.title.trim() || '');
	let caption = $derived(snippet(note.content_markdown));
	let body = $derived(excerpt(textOnly) || firstLine(note.title) || 'Untitled');

	// A note that's still syncing has no server id behind it, so it reads as
	// part of the stream but isn't something you can open yet.
	let queued = $derived(isPending(note));

	// Thoughts added to this one since. Collapsed by default and expanded in
	// place: opening a thread has to cost less than the thought it holds.
	let thoughts = $derived(note.children ?? []);
	let expanded = $state(false);
</script>

<!--
	Sized like the thing it is. A thought is the content of this app, so it's
	set at 19px — reading size — rather than at the 16px that made the stream
	look like a list of file names. The row breathes to match, and the meta
	line under it is small but *bold*: small and light is what reads as filler.
-->
<div class="entry py-[19px]" style={queued ? 'opacity: 0.5;' : ''} aria-busy={queued || undefined}>
	<a
		href={queued ? undefined : `/note/${note.id}`}
		class="block active:opacity-65"
		aria-label={heading || firstLine(note.content_markdown) || 'Note'}
	>
		{#if isLink}
			<div class="flex items-start gap-4">
				<div class="min-w-0 flex-1">
					{#if heading}
						<h3
							class="line-clamp-2 font-serif text-[1.16rem] leading-[1.32] font-semibold tracking-[-0.018em]"
						>
							{heading}
						</h3>
					{/if}
					{#if caption}
						<p
							class="mt-1.5 line-clamp-2 font-serif text-[1.03rem] leading-[1.42] tracking-[-0.01em]"
							style="color: var(--color-ink-2);"
						>
							{caption}
						</p>
					{/if}
				</div>
				{#if note.source_image}
					<img
						src={note.source_image}
						alt=""
						loading="lazy"
						class="h-[72px] w-[72px] shrink-0 rounded-[20px] object-cover"
						style="background: var(--color-surface-2);"
					/>
				{/if}
			</div>
		{:else if hasEmbeddedImage}
			<div class="flex items-start gap-4">
				<img
					src={embeddedImage}
					alt=""
					loading="lazy"
					class="h-[72px] w-[72px] shrink-0 rounded-[20px] object-cover"
					style="background: var(--color-surface-2);"
				/>
				{#if textOnly.trim()}
					<p
						class="line-clamp-3 min-w-0 flex-1 font-serif text-[1.19rem] leading-[1.5] tracking-[-0.012em] whitespace-pre-wrap"
					>
						{excerpt(textOnly, 200)}
					</p>
				{/if}
			</div>
		{:else}
			<!-- Clamped: a note is as long as it needs to be, but a *list* of notes
			     is only useful if you can see more than one of them at a time. -->
			<p
				class="line-clamp-6 font-serif text-[1.19rem] leading-[1.5] tracking-[-0.012em] whitespace-pre-wrap"
			>
				{body}
			</p>
		{/if}
	</a>

	<!--
		The meta line, and the only place in the stream that offers to *write*.

		"+" attaches the composer to this thought and opens it — no navigation,
		no reading back what's already there. It sits where the App Store puts
		its action, on every row, because any note can become a thread: you
		never create one, you just add to something twice.
	-->
	<div
		class="mt-3 flex items-center gap-2.5 text-[0.82rem] font-bold tracking-[-0.01em]"
		style="color: var(--color-ink-faint);"
	>
		{#each note.tags as tag (tag.id)}
			<TagChip {tag} />
		{/each}
		<span class="flex-1"></span>
		{#if isLink && note.source_url}
			<span class="truncate font-semibold" style="color: var(--color-ink-muted);"
				>{hostname(note.source_url)}</span
			>
		{/if}
		{#if showTime}
			{#if isLink}<span aria-hidden="true">·</span>{/if}
			<span class="font-semibold whitespace-nowrap tabular-nums">{timeOfDay(streamDate(note))}</span
			>
		{/if}
		{#if !queued}
			<button
				type="button"
				aria-label="Add a thought to this"
				class="-my-1 grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full active:scale-90"
				style="background: var(--color-surface-2); color: var(--color-ink-muted);"
				onclick={() => writeInto(stubOf(note))}
			>
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="3"
					stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg
				>
			</button>
		{/if}
	</div>

	{#if thoughts.length > 0}
		<button
			type="button"
			class="mt-2.5 flex items-center gap-1.5 text-[0.78rem] font-bold tracking-[-0.01em] active:opacity-60"
			style="color: var(--color-accent);"
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}
		>
			<svg
				width="11"
				height="11"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="3.4"
				stroke-linecap="round"
				stroke-linejoin="round"
				style="transition: transform 180ms ease; transform: rotate({expanded ? 90 : 0}deg);"
				><path d="m9 5 7 7-7 7" /></svg
			>
			{thoughts.length}
			{thoughts.length === 1 ? 'thought' : 'thoughts'}
			<span style="color: var(--color-ink-faint);">· {relativeTime(lastActivity(note))}</span>
		</button>

		{#if expanded}
			<!-- No indent rail: a continuation is a peer of the thought above
			     it, not a reply to it. -->
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
