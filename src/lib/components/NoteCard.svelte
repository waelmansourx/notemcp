<script lang="ts">
	import type { Note } from '$lib/types';
	import { relativeTime, hostname } from '$lib/dates';
	import { firstLine, snippet } from '$lib/markdown';

	let { note }: { note: Note } = $props();

	let title = $derived(note.title.trim() || firstLine(note.content_markdown) || 'Untitled');
	let preview = $derived(snippet(note.content_markdown));
</script>

<a
	href={`/note/${note.id}`}
	class="block rounded-[var(--radius-lg)] px-3.5 py-2.5 active:opacity-70"
	style="background: var(--color-surface); border: 1px solid var(--color-border);"
>
	<div class="flex items-start gap-2.5">
		{#if note.source_image}
			<img
				src={note.source_image}
				alt=""
				class="mt-0.5 h-9 w-9 shrink-0 rounded-[var(--radius-sm)] object-cover"
				style="background: var(--color-surface-2);"
			/>
		{/if}
		<div class="min-w-0 flex-1">
			<div class="flex items-start justify-between gap-3">
				<h3 class="truncate font-serif text-[0.925rem] font-medium">{title}</h3>
				<div class="flex shrink-0 items-center gap-1.5 pt-0.5">
					{#if note.pinned}
						<span style="color: var(--color-ink-faint);" aria-label="Pinned">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"
								><path
									d="M14.5 2.5a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4l-1.1 1.1a1 1 0 0 1-1.4 0l-.3-.3-3.2 3.2.7 2.9a1 1 0 0 1-.27.96l-.9.9a1 1 0 0 1-1.42 0l-3.6-3.6-4.6 4.6a1 1 0 0 1-1.42-1.42l4.6-4.6-3.6-3.6a1 1 0 0 1 0-1.42l.9-.9a1 1 0 0 1 .96-.27l2.9.7 3.2-3.2-.3-.3a1 1 0 0 1 0-1.4z"
								/></svg
							>
						</span>
					{/if}
					<span class="text-xs whitespace-nowrap" style="color: var(--color-ink-faint);"
						>{relativeTime(note.created_at)}</span
					>
				</div>
			</div>

			{#if preview}
				<p
					class="mt-0.5 line-clamp-2 font-serif text-sm leading-snug"
					style="color: var(--color-ink-muted);"
				>
					{preview}
				</p>
			{/if}

			{#if note.tags.length > 0 || note.source_url}
				<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
					{#if note.source_url}
						<span
							class="rounded-full px-2 py-0.5 text-[0.7rem]"
							style="background: var(--color-surface-2); color: var(--color-ink-muted);"
						>
							{hostname(note.source_url)}
						</span>
					{/if}
					{#each note.tags as tag (tag.id)}
						<span class="text-[0.7rem]" style="color: var(--color-accent);">#{tag.name}</span>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</a>
