<script lang="ts">
	import type { Tag } from '$lib/types';
	import { normalizeTagName } from '$lib/tags';

	let {
		selected = $bindable(),
		recent = [],
		onpick
	}: {
		selected: string[];
		recent?: Tag[];
		/** Called after any pick, so the host can put the caret back where the
		 *  user was actually writing. */
		onpick?: () => void;
	} = $props();

	// Tags typed during this session, newest first. A tag you just invented is
	// the one you're most likely to want again in the next thought, so it goes
	// to the front of the row rather than the end of a list you'd have to
	// scroll to reach.
	let freshTags = $state<string[]>([]);

	let tagRow = $state<HTMLDivElement | null>(null);

	let suggestions = $derived.by(() => {
		const names: string[] = [];
		for (const name of [...freshTags, ...selected, ...recent.map((t) => t.name)]) {
			if (name && !names.includes(name)) names.push(name);
		}
		return names.slice(0, 10);
	});

	function toggleTag(name: string, event?: MouseEvent) {
		selected = selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name];
		onpick?.();

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
		newTagInput = '';
		addingTag = false;

		if (!name) {
			onpick?.();
			return;
		}

		if (!selected.includes(name)) selected = [...selected, name];
		freshTags = [name, ...freshTags.filter((t) => t !== name)];

		// It's now the first chip in the row — make sure the row is actually
		// showing its start, so the tag you just made is visible instead of
		// somewhere off to the right.
		queueMicrotask(() => tagRow?.scrollTo({ left: 0, behavior: 'smooth' }));
		onpick?.();
	}

	function cancelNewTag() {
		newTagInput = '';
		addingTag = false;
		onpick?.();
	}
</script>

<!--
	Tags as a scrolling row rather than a grid of boxes.

	"+ Tag" is pinned first so it's always reachable regardless of how far the
	row scrolls, and a tag you've just made lands at the head of that row
	rather than off the end of it. While you're typing one, an explicit ✓ sits
	next to the field: confirming shouldn't mean guessing that Enter works.
-->
<div class="flex shrink-0 items-center gap-1.5">
	{#if addingTag}
		<div
			class="flex min-h-8 shrink-0 items-center rounded-full border py-0.5 pr-0.5 pl-3"
			style="border-color: var(--color-accent); background: var(--color-accent-soft);"
		>
			<input
				bind:this={newTagInputEl}
				bind:value={newTagInput}
				type="text"
				placeholder="Tag name"
				autocapitalize="none"
				autocomplete="off"
				autocorrect="off"
				enterkeyhint="done"
				class="w-24 bg-transparent text-[0.8rem] font-medium outline-none"
				style="color: var(--color-accent);"
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
			<button
				type="button"
				aria-label="Add tag"
				class="grid h-7 w-7 shrink-0 place-items-center rounded-full active:scale-95"
				style="background: var(--color-accent); color: var(--color-accent-ink);"
				onclick={commitNewTag}
			>
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.8"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg
				>
			</button>
		</div>
	{:else}
		<button
			type="button"
			class="flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 py-1.5 text-[0.8125rem] font-semibold whitespace-nowrap active:scale-95"
			style="border-color: var(--color-accent); color: var(--color-accent); background: none;"
			onclick={startNewTag}
		>
			<svg
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="3"
				stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg
			>
			Tag
		</button>
	{/if}

	<div class="relative min-w-0 flex-1">
		<div
			bind:this={tagRow}
			class="flex items-center gap-1.5 overflow-x-auto pr-6"
			style="scrollbar-width: none;"
		>
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
			style="background: linear-gradient(to right, transparent, var(--fade-to, var(--color-surface)));"
		></div>
	</div>
</div>
