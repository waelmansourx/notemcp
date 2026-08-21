<script lang="ts">
	import type { Tag, ThreadStub } from '$lib/types';
	import { relativeTime } from '$lib/dates';
	import { tagDisplay } from '$lib/tags';

	let {
		tag,
		count,
		notes: initialNotes,
		label = tagDisplay(tag.name),
		featured = false
	}: {
		tag: Tag;
		count: number;
		notes: ThreadStub[];
		label?: string;
		featured?: boolean;
	} = $props();

	let notes = $state<ThreadStub[]>(initialNotes);
	let loadingMore = $state(false);
	let exhausted = $state(initialNotes.length >= count);
	let wheelLocked = false;
	let wheelUnlockTimer: ReturnType<typeof setTimeout> | undefined;

	let pages = $derived.by(() => {
		const out: ThreadStub[][] = [];
		for (let i = 0; i < notes.length; i += 3) out.push(notes.slice(i, i + 3));
		return out;
	});

	async function loadMore() {
		if (loadingMore || exhausted) return;
		loadingMore = true;
		try {
			const params = new URLSearchParams({
				name: tag.name,
				offset: String(notes.length),
				limit: '9'
			});
			const response = await fetch(`/api/tags?${params}`);
			if (!response.ok) return;
			const payload: { notes: ThreadStub[]; hasMore: boolean } = await response.json();
			const seen = new Set(notes.map((note) => note.id));
			const incoming = payload.notes.filter((note) => !seen.has(note.id));
			notes = [...notes, ...incoming];
			exhausted = !payload.hasMore || incoming.length === 0;
		} finally {
			loadingMore = false;
		}
	}

	function onShelfScroll(event: Event) {
		const el = event.currentTarget as HTMLElement;
		if (el.scrollWidth - el.scrollLeft - el.clientWidth < 220) loadMore();
	}

	// The compact shelves are pages of three rows. A mouse-wheel/trackpad gesture
	// should move exactly one page rather than leaving the shelf stranded halfway
	// between columns. Touch dragging remains direct and unmodified.
	function onPagedWheel(event: WheelEvent) {
		const el = event.currentTarget as HTMLElement;
		const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
		if (Math.abs(delta) < 2) return;

		if (wheelUnlockTimer !== undefined) clearTimeout(wheelUnlockTimer);
		wheelUnlockTimer = setTimeout(() => {
			wheelLocked = false;
			wheelUnlockTimer = undefined;
		}, 150);
		if (wheelLocked) {
			event.preventDefault();
			return;
		}

		const page = el.querySelector<HTMLElement>('[data-shelf-page]');
		if (!page) return;
		const styles = getComputedStyle(el);
		const gap = Number.parseFloat(styles.columnGap || styles.gap || '0') || 0;
		const step = page.offsetWidth + gap;
		if (step <= 0) return;

		const current = Math.round(el.scrollLeft / step);
		const max = Math.max(0, pages.length - 1);
		const next = Math.min(max, Math.max(0, current + (delta > 0 ? 1 : -1)));
		if (next === current) return;

		event.preventDefault();
		wheelLocked = true;
		el.scrollTo({ left: next * step, behavior: 'auto' });
	}
</script>

<section class="min-w-0 border-b py-3.5" style="border-color: var(--color-border);">
	<div class="flex min-w-0 items-baseline gap-2.5">
		<a href={`/tags/${encodeURIComponent(tag.name)}`} class="min-w-0 active:opacity-60">
			<span class="tag tag-lg block truncate"><span style="color: #c8c0b0; font-weight: 400;">#</span>{label}</span>
		</a>
		<span class="flex-1"></span>
		{#if count > 3}
			<a
				href={`/tags/${encodeURIComponent(tag.name)}`}
				class="shrink-0 text-[0.72rem] active:opacity-60"
				style="color: var(--color-ink-faint);"
			>
				See all
			</a>
		{/if}
	</div>

	{#if featured}
		<!-- The freshest tag gets the visual shelf: one large thumbnail card per
		     note, as before. Only this first/top tag uses this treatment. -->
		<div class="shelf-scroll mt-3 flex max-w-full gap-3 overflow-x-auto pb-1" onscroll={onShelfScroll}>
			{#each notes as note (note.id)}
				<a href={`/note/${note.id}`} class="w-[152px] max-w-[44vw] shrink-0 active:opacity-65">
					<div
						class="relative aspect-[19/12] w-full overflow-hidden rounded-[14px]"
						style="background: var(--color-surface-2);"
					>
						{#if note.image}
							<img
								src={note.image}
								alt=""
								loading="lazy"
								aria-hidden="true"
								class="absolute inset-0 h-full w-full scale-125 object-cover blur-lg opacity-75"
								style="filter: blur(14px) saturate(1.75) contrast(1.08);"
							/>
							<div
								class="absolute inset-0"
								style="background: color-mix(in srgb, var(--color-surface-2) 12%, transparent);"
							></div>
							<img
								src={note.image}
								alt=""
								loading="lazy"
								class="relative z-10 h-full w-full object-contain object-center"
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
			{#if loadingMore}
				<div class="w-8 shrink-0" aria-label="Loading more notes"></div>
			{/if}
		</div>
	{:else}
		<div
			class="shelf-scroll mt-2.5 flex max-w-full gap-5 overflow-x-auto pb-1"
			onscroll={onShelfScroll}
			onwheel={onPagedWheel}
		>
			{#each pages as pageNotes, i (i)}
				<div data-shelf-page class="w-[min(330px,90vw)] shrink-0">
					{#each pageNotes as note, j (note.id)}
						<a
							href={`/note/${note.id}`}
							class="flex min-h-[78px] items-center gap-3 py-2 active:opacity-60"
						>
							<div
								class="relative h-[62px] w-[82px] shrink-0 overflow-hidden rounded-[12px]"
								style="background: var(--color-surface-2);"
							>
								{#if note.image}
									<img
										src={note.image}
										alt=""
										loading="lazy"
										aria-hidden="true"
										class="absolute inset-0 h-full w-full scale-125 object-cover blur-md opacity-70"
										style="filter: blur(10px) saturate(1.55) contrast(1.05);"
									/>
									<div
										class="absolute inset-0"
										style="background: color-mix(in srgb, var(--color-surface-2) 16%, transparent);"
									></div>
									<img
										src={note.image}
										alt=""
										loading="lazy"
										class="relative z-10 h-full w-full object-contain object-center"
									/>
								{:else}
									<div
										class="grid h-full w-full place-items-center font-serif text-[1.25rem]"
										style="color: var(--color-ink-faint);"
									>
										{note.label.slice(0, 1).toUpperCase()}
									</div>
								{/if}
							</div>

							<div class="min-w-0 flex-1">
								<p class="line-clamp-2 text-[0.82rem] leading-[1.38]">{note.label}</p>
								<p class="mt-1 truncate text-[0.66rem]" style="color: var(--color-ink-faint);">
									{note.source ? `${note.source} · ` : ''}{relativeTime(note.at)}
								</p>
							</div>
						</a>
						{#if j < pageNotes.length - 1}
							<div class="h-px ml-[94px]" style="background: var(--color-border);"></div>
						{/if}
					{/each}
				</div>
			{/each}
			{#if loadingMore}
				<div class="w-8 shrink-0" aria-label="Loading more notes"></div>
			{/if}
		</div>
	{/if}
</section>
