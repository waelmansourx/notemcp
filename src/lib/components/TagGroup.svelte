<script lang="ts">
	import type { Tag, ThreadStub } from '$lib/types';
	import { relativeTime } from '$lib/dates';
	import { tagDisplay } from '$lib/tags';

	let {
		tag,
		count,
		notes,
		label = tagDisplay(tag.name),
		depth = 0
	}: {
		tag: Tag;
		count: number;
		notes: ThreadStub[];
		label?: string;
		depth?: number;
	} = $props();

	// If a tag has any image-bearing saves, let it read as a visual shelf.
	// The old threshold (2 of the first 3) hid perfectly good thumbnails when
	// only one recent save happened to have one.
	let visual = $derived(notes.some((note) => Boolean(note.image)));
	let nested = $derived(depth > 0);

	let pages = $derived.by(() => {
		const out: ThreadStub[][] = [];
		for (let i = 0; i < notes.length; i += 3) out.push(notes.slice(i, i + 3));
		return out;
	});
</script>

<section
	class="relative min-w-0 border-b py-3.5"
	class:pl-7={nested}
	style="border-color: var(--color-border);"
>
	{#if nested}
		<span
			class="absolute top-0 bottom-0 left-2.5 w-px"
			style="background: color-mix(in srgb, var(--color-border) 88%, transparent);"
			aria-hidden="true"
		></span>
		<span
			class="absolute top-[31px] left-2.5 h-px w-3"
			style="background: var(--color-border);"
			aria-hidden="true"
		></span>
	{/if}

	<div class="flex min-w-0 items-baseline gap-2.5">
		<a href={`/tags/${encodeURIComponent(tag.name)}`} class="min-w-0 active:opacity-60">
			{#if nested}
				<span class="tag tag-lg block truncate" style="font-size: 1.34rem;">
					<span style="color: var(--color-ink-faint); font-weight: 400;">/</span>{label}
				</span>
			{:else}
				<span class="tag tag-lg block truncate">
					<span style="color: #c8c0b0; font-weight: 400;">#</span>{label}
				</span>
			{/if}
		</a>
		<span class="flex-1"></span>
		{#if count > notes.length}
			<a
				href={`/tags/${encodeURIComponent(tag.name)}`}
				class="shrink-0 text-[0.72rem] active:opacity-60"
				style="color: var(--color-ink-faint);"
			>
				See all
			</a>
		{/if}
	</div>

	{#if visual}
		<div class="shelf-scroll mt-3 flex max-w-full gap-3 overflow-x-auto pb-1">
			{#each notes as note (note.id)}
				<a href={`/note/${note.id}`} class="w-[152px] max-w-[44vw] shrink-0 active:opacity-65">
					<div
						class="aspect-[19/12] w-full overflow-hidden rounded-[12px]"
						style="background: var(--color-surface-2);"
					>
						{#if note.image}
							<img
								src={note.image}
								alt=""
								loading="lazy"
								class="h-full w-full object-cover object-center"
							/>
						{:else}
							<div
								class="grid h-full w-full place-items-center font-serif text-[1.4rem]"
								style="color: var(--color-ink-faint);"
							>
								{note.label.slice(0, 1).toUpperCase()}
							</div>
						{/if}
					</div>
					<p class="mt-2 line-clamp-2 text-[0.78rem] leading-[1.35] font-medium">{note.label}</p>
					<p class="mt-1 truncate text-[0.66rem]" style="color: var(--color-ink-faint);">
						{note.source ? `${note.source} · ` : ''}{relativeTime(note.at)}
					</p>
				</a>
			{/each}
		</div>
	{:else}
		<div class="shelf-scroll mt-2.5 flex max-w-full gap-5 overflow-x-auto pb-1">
			{#each pages as pageNotes, i (i)}
				<div class="w-[min(316px,88vw)] shrink-0">
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
