<script lang="ts">
	import type { Tag, ThreadStub } from '$lib/types';
	import { relativeTime } from '$lib/dates';
	import { tagDisplay } from '$lib/tags';

	let {
		tag,
		count,
		notes,
		label = tagDisplay(tag.name)
	}: {
		tag: Tag;
		count: number;
		notes: ThreadStub[];
		label?: string;
	} = $props();

	let visual = $derived(notes.slice(0, 3).filter((note) => note.image).length >= 2);

	let pages = $derived.by(() => {
		const out: ThreadStub[][] = [];
		for (let i = 0; i < notes.length; i += 3) out.push(notes.slice(i, i + 3));
		return out;
	});
</script>

<section class="border-b py-3.5" style="border-color: var(--color-border);">
	<div class="flex items-baseline gap-2.5">
		<a href={`/?tag=${encodeURIComponent(tag.name)}`} class="min-w-0 active:opacity-60">
			<span class="tag tag-lg block truncate"><span style="color: #c8c0b0; font-weight: 400;">#</span>{label}</span>
		</a>
		<span class="flex-1"></span>
		<a
			href={`/?tag=${encodeURIComponent(tag.name)}`}
			class="shrink-0 text-[0.72rem] active:opacity-60"
			style="color: var(--color-ink-faint);"
		>
			{count > 3 ? 'See all' : 'Open'}
		</a>
	</div>

	{#if visual}
		<div class="-mr-[26px] mt-3 flex gap-3 overflow-x-auto pr-[26px]" style="scrollbar-width: none;">
			{#each notes as note (note.id)}
				<a href={`/note/${note.id}`} class="w-[152px] shrink-0 active:opacity-65">
					{#if note.image}
						<img
							src={note.image}
							alt=""
							loading="lazy"
							class="h-[96px] w-[152px] rounded-[12px] object-cover"
							style="background: var(--color-surface-2);"
						/>
					{:else}
						<div
							class="grid h-[96px] w-[152px] place-items-center rounded-[12px] font-serif text-[1.4rem]"
							style="background: var(--color-surface-2); color: var(--color-ink-faint);"
						>
							{note.label.slice(0, 1).toUpperCase()}
						</div>
					{/if}
					<p class="mt-2 line-clamp-2 text-[0.78rem] leading-[1.35] font-medium">{note.label}</p>
					<p class="mt-1 truncate text-[0.66rem]" style="color: var(--color-ink-faint);">
						{note.source ? `${note.source} · ` : ''}{relativeTime(note.at)}
					</p>
				</a>
			{/each}
		</div>
	{:else}
		<div class="-mr-[26px] mt-2.5 flex snap-x snap-mandatory gap-5 overflow-x-auto pr-[26px]" style="scrollbar-width: none;">
			{#each pages as pageNotes, i (i)}
				<div class="w-[316px] shrink-0 snap-start">
					{#each pageNotes as note, j (note.id)}
						<a href={`/note/${note.id}`} class="block py-2 active:opacity-60">
							<p class="line-clamp-2 text-[0.82rem] leading-[1.4]">{note.label}</p>
							<p class="mt-1 text-[0.66rem]" style="color: var(--color-ink-faint);">{relativeTime(note.at)}</p>
						</a>
						{#if j < pageNotes.length - 1}
							<div class="h-px" style="background: var(--color-border);"></div>
						{/if}
					{/each}
				</div>
			{/each}
		</div>
	{/if}
</section>
