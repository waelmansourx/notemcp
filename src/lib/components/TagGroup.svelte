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

<section class="tag-shelf min-w-0 border-b py-3" style="border-color: var(--color-border);">
	<div class="flex min-w-0 items-baseline gap-3">
		<a href={`/tags/${encodeURIComponent(tag.name)}`} class="min-w-0 active:opacity-60">
			<span class="tag tag-lg shelf-title block truncate"><span class="shelf-hash">#</span>{label}</span>
		</a>
		<span class="flex-1"></span>
		{#if count > 3}
			<a
				href={`/tags/${encodeURIComponent(tag.name)}`}
				class="shrink-0 text-[0.74rem] font-medium active:opacity-60"
				style="color: var(--color-accent-path);"
			>
				See all
			</a>
		{/if}
	</div>

	{#if featured}
		<!-- The freshest tag gets the visual shelf: one large thumbnail card per
		     note, as before. Only this first/top tag uses this treatment. -->
		<div
			class="shelf-scroll mt-2.5 flex max-w-full gap-3.5 overflow-x-auto pb-1"
			onscroll={onShelfScroll}
		>
			{#each notes as note (note.id)}
				<a href={`/note/${note.id}`} class="w-[168px] max-w-[47vw] shrink-0 active:opacity-65">
					<div
						class="relative aspect-[4/3] w-full overflow-hidden rounded-[16px]"
						style="background: var(--color-surface-2); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-border) 70%, transparent);"
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
								style="background: color-mix(in srgb, var(--color-surface-2) 5%, transparent);"
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
					<p
						class="mt-2 line-clamp-2 text-[0.82rem] leading-[1.38] font-medium"
						style="color: var(--color-ink);"
					>
						{note.label}
					</p>
					<div
						class="mt-1 flex min-w-0 items-center gap-1.5 truncate text-[0.66rem]"
						style="color: var(--color-ink-faint);"
					>
						{#if note.source}
							<span class="source-label min-w-0 truncate">{note.source}</span>
						{/if}
						<span class="shrink-0">{relativeTime(note.at)}</span>
					</div>
				</a>
			{/each}
			{#if loadingMore}
				<div class="w-8 shrink-0" aria-label="Loading more notes"></div>
			{/if}
		</div>
	{:else}
		<div
			class="shelf-scroll shelf-frame mt-2 flex max-w-full gap-4 overflow-x-auto px-2.5 py-1"
			onscroll={onShelfScroll}
			onwheel={onPagedWheel}
		>
			{#each pages as pageNotes, i (i)}
				<div data-shelf-page class="w-[min(316px,82vw)] shrink-0">
					{#each pageNotes as note, j (note.id)}
						<a
							href={`/note/${note.id}`}
							class="flex min-h-[70px] items-center gap-2.5 py-1.5 active:opacity-60"
						>
							<div
								class="relative shrink-0 overflow-hidden rounded-[11px] {note.image
									? 'h-[58px] w-[76px]'
									: 'h-[52px] w-[52px]'}"
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
										style="background: color-mix(in srgb, var(--color-surface-2) 6%, transparent);"
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
										style="color: var(--color-accent-path);"
									>
										{note.label.slice(0, 1).toUpperCase()}
									</div>
								{/if}
							</div>

							<div class="min-w-0 flex-1">
								<p
									class="line-clamp-2 text-[0.84rem] leading-[1.38] font-medium"
									style="color: var(--color-ink-2);"
								>
									{note.label}
								</p>
								<div
									class="mt-1 flex min-w-0 items-center gap-1.5 truncate text-[0.65rem]"
									style="color: var(--color-ink-faint);"
								>
									{#if note.source}
										<span class="source-label min-w-0 truncate">{note.source}</span>
									{/if}
									<span class="shrink-0">{relativeTime(note.at)}</span>
								</div>
							</div>
						</a>
						{#if j < pageNotes.length - 1}
							<div
								class="ml-[64px] h-px"
								style="background: color-mix(in srgb, var(--color-border) 82%, transparent);"
							></div>
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

<style>
	.shelf-title {
		color: var(--color-accent-path);
		font-size: 1.68rem;
		font-weight: 560;
		letter-spacing: -0.02em;
	}

	.shelf-hash {
		color: color-mix(in srgb, var(--color-accent-path) 42%, var(--color-bg));
		font-weight: 400;
	}

	.shelf-frame {
		border-left: 3px solid
			color-mix(in srgb, var(--color-accent-path) 46%, var(--color-border));
		border-radius: 14px;
		background: color-mix(in srgb, var(--color-surface-2) 58%, transparent);
	}

	.source-label {
		max-width: 9.5rem;
		border-radius: 999px;
		padding: 0.1rem 0.38rem;
		background: color-mix(in srgb, var(--color-success-soft) 76%, transparent);
		color: var(--color-accent-path);
		font-weight: 650;
		letter-spacing: -0.01em;
	}

	@media (prefers-color-scheme: dark) {
		.shelf-hash {
			color: color-mix(in srgb, var(--color-accent-path) 54%, var(--color-bg));
		}

		.shelf-frame {
			background: color-mix(in srgb, var(--color-surface-2) 72%, transparent);
		}
	}
</style>
