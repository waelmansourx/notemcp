<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import EditorToolbar from '$lib/components/EditorToolbar.svelte';
	import { hostname, timeOfDay } from '$lib/dates';
	import { clearDraft, isNewerThan, pruneDrafts, readDraft, saveDraft } from '$lib/draft.svelte';
	import { stubOf } from '$lib/thread';
	import { writeInto } from '$lib/composer.svelte';
	import Thought from './Thought.svelte';
	import type { Note } from '$lib/types';

	let {
		existingNote = null,
		prefill = null,
		thread = []
	}: {
		existingNote?: Note | null;
		/** Every thought in this thread, oldest first, including this one. */
		thread?: Note[];
		prefill?: {
			title?: string;
			content_markdown?: string;
			source_url?: string | null;
			source_title?: string | null;
			source_description?: string | null;
			source_image?: string | null;
		} | null;
	} = $props();

	/*
	 * A thread reads as one conversation, so the thought you opened is shown
	 * where it actually falls in time — with whatever came before it above and
	 * whatever came after below — rather than as a document with the others
	 * filed underneath it as replies. Every thought in a thread is a peer; the
	 * only thing special about this one is that it's the one you're editing.
	 */
	let position = $derived(existingNote ? thread.findIndex((t) => t.id === existingNote.id) : -1);
	let before = $derived(position > 0 ? thread.slice(0, position) : []);
	let after = $derived(position >= 0 ? thread.slice(position + 1) : []);
	let inThread = $derived(thread.length > 1);

	// Opening the fourth thought shouldn't dump you at the first one. The
	// editor is scrolled to the top of the viewport once, on mount, so you
	// land on what you tapped and the earlier thoughts are simply above you.
	let editorBlock = $state<HTMLDivElement | null>(null);
	onMount(() => {
		if (before.length === 0 || !editorBlock) return;
		editorBlock.scrollIntoView({ block: 'start' });
	});

	let id = $state(existingNote?.id ?? null);
	let title = $state(existingNote?.title ?? prefill?.title ?? '');
	let content = $state(existingNote?.content_markdown ?? prefill?.content_markdown ?? '');
	let sourceUrl = $state(existingNote?.source_url ?? prefill?.source_url ?? null);
	let linkTitle = $state(existingNote?.source_title ?? prefill?.source_title ?? null);
	let linkDescription = $state(
		existingNote?.source_description ?? prefill?.source_description ?? null
	);
	let linkImage = $state(existingNote?.source_image ?? prefill?.source_image ?? null);
	let pinned = $state(existingNote?.pinned ?? false);
	let tags = $state<{ id: string | null; name: string }[]>(
		existingNote?.tags.map((t) => ({ id: t.id, name: t.name })) ?? []
	);
	let tagInput = $state('');
	let editingTagIndex = $state<number | null>(null);
	let editTagValue = $state('');
	let tagError = $state('');
	let saveState = $state<'idle' | 'saving' | 'saved'>('idle');
	let deleting = $state(false);

	let editor = $state<ReturnType<typeof MarkdownEditor> | null>(null);
	let editorFocused = $state(false);

	// Only one bar sits above the keyboard: formatting while you're writing,
	// tags when you're not. Hiding lags focus slightly so that a tap which
	// briefly moves focus can't make the toolbar vanish out from under it.
	let showToolbar = $state(false);
	$effect(() => {
		if (editorFocused) {
			showToolbar = true;
			return;
		}
		const timer = setTimeout(() => (showToolbar = false), 200);
		return () => clearTimeout(timer);
	});

	// `interactive-widget=resizes-content` (app.html) handles this on newer
	// Chrome by shrinking the layout viewport with the keyboard, which is all
	// `sticky; bottom: 0` needs. Older Chrome and Safari don't honor it, so
	// the toolbar sticks to the bottom of the *unshrunk* layout — behind the
	// keyboard — unless it's nudged up by however much the visual viewport
	// has actually shrunk.
	let toolbarBar = $state<HTMLDivElement | null>(null);
	$effect(() => {
		const vv = window.visualViewport;
		if (!vv || !toolbarBar) return;
		const bar = toolbarBar;
		function reposition() {
			const overlap = window.innerHeight - vv!.height - vv!.offsetTop;
			bar.style.transform = overlap > 1 ? `translateY(-${overlap}px)` : '';
		}
		vv.addEventListener('resize', reposition);
		vv.addEventListener('scroll', reposition);
		reposition();
		return () => {
			vv.removeEventListener('resize', reposition);
			vv.removeEventListener('scroll', reposition);
		};
	});

	/*
	 * Autosave.
	 *
	 * The old version fired 600ms after every keystroke and re-sent the whole
	 * note each time — including `tagNames`, which the API implements as
	 * "delete every note_tags row, then re-insert them". Typing a sentence
	 * therefore rewrote the note's tags several times over.
	 *
	 * Now the text is written to localStorage on every change, synchronously,
	 * so it is never at risk while we wait. That buys a much longer idle
	 * window before the network write — plus a snapshot of what the server
	 * last confirmed, so an unchanged note never writes at all, and a PATCH
	 * body containing only the fields that actually moved.
	 */
	const AUTOSAVE_MS = 5000;

	type Snapshot = { title: string; content: string; pinned: boolean; tags: string };

	function snapshot(): Snapshot {
		// \u0000 can't appear in a tag name, so joining on it can't collide.
		return { title, content, pinned, tags: tags.map((t) => t.name).join('\u0000') };
	}

	function same(a: Snapshot, b: Snapshot): boolean {
		return (
			a.title === b.title && a.content === b.content && a.pinned === b.pinned && a.tags === b.tags
		);
	}

	// Deliberately not $state: this is a record of what the server has, not
	// something the UI renders, and keeping it out of the graph stops the
	// autosave effect from re-running on its own result.
	let saved: Snapshot | null = existingNote ? snapshot() : null;
	// Stable for the life of this editor, so a note that hasn't been created
	// yet still has somewhere consistent to keep its draft.
	const clientId = crypto.randomUUID();
	let inFlight = false;
	let queuedAgain = false;

	/** Where this note's local draft lives. A note being written for the first
	 *  time has no id yet, so it borrows its client id. */
	let draftKey = $derived(id ?? clientId);

	$effect(() => {
		const next = snapshot();
		if (saved && same(saved, next)) return;

		// Synchronous and immediate: whatever happens next — a dead network, a
		// backgrounded tab, a browser that decides to reclaim the page — the
		// words are already on the disk.
		saveDraft(draftKey, {
			title: next.title,
			content: next.content,
			tags: tags.map((t) => t.name)
		});

		const timer = setTimeout(persist, AUTOSAVE_MS);
		return () => clearTimeout(timer);
	});

	/*
	 * Recover anything a previous visit didn't manage to send — but exactly
	 * once, on mount, and deliberately outside the reactive graph. An effect
	 * that both reads the note's text and writes it re-runs on every keystroke,
	 * and would race the autosave effect for the same localStorage key: one
	 * writing the draft, the other deciding it was redundant and deleting it.
	 */
	onMount(() => {
		pruneDrafts();
		if (!existingNote) return;

		const draft = readDraft(existingNote.id);
		if (!draft) return;

		const stale = !isNewerThan(draft, existingNote.updated_at);
		const redundant = draft.content === content && draft.title === title;
		if (stale || redundant) {
			clearDraft(existingNote.id);
			return;
		}

		title = draft.title;
		content = draft.content;
		tags = draft.tags.map((name) => ({ id: null, name }));
	});

	// Leaving the page shouldn't cost you the last sentence you typed — on
	// mobile, backgrounding the app is the usual way a note gets abandoned
	// mid-edit, and `visibilitychange` is the only event that reliably fires
	// for it.
	$effect(() => {
		function flush() {
			if (document.visibilityState === 'hidden') persist();
		}
		document.addEventListener('visibilitychange', flush);
		return () => document.removeEventListener('visibilitychange', flush);
	});

	async function persist() {
		if (!title.trim() && !content.trim()) return;

		const next = snapshot();
		if (saved && same(saved, next)) return;

		// A save is already out. Don't race it — note that another is owed and
		// let the in-flight one start it on the way out.
		if (inFlight) {
			queuedAgain = true;
			return;
		}
		inFlight = true;
		saveState = 'saving';

		try {
			if (!id) {
				const res = await fetch('/api/notes', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						client_id: clientId,
						title: next.title,
						content_markdown: next.content,
						source_url: sourceUrl,
						source_type: sourceUrl ? 'share' : 'manual',
						source_title: linkTitle,
						source_description: linkDescription,
						source_image: linkImage,
						pinned: next.pinned,
						tagNames: tags.map((t) => t.name)
					})
				});
				if (!res.ok) {
					saveState = 'idle';
					return;
				}
				const note = await res.json();
				// The draft moves with the note: it was filed under the client id
				// until the server gave us a real one.
				clearDraft(clientId);
				id = note.id;
				history.replaceState(history.state, '', `/note/${id}`);
			} else {
				const body: Record<string, unknown> = {};
				if (!saved || saved.title !== next.title) body.title = next.title;
				if (!saved || saved.content !== next.content) body.content_markdown = next.content;
				if (!saved || saved.pinned !== next.pinned) body.pinned = next.pinned;
				// Sending tagNames rewrites every note_tags row for this note, so
				// it only goes out when the tags themselves have changed.
				if (!saved || saved.tags !== next.tags) body.tagNames = tags.map((t) => t.name);

				if (Object.keys(body).length > 0) {
					const res = await fetch(`/api/notes/${id}`, {
						method: 'PATCH',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(body)
					});
					if (!res.ok) {
						saveState = 'idle';
						return;
					}
				}
			}

			saved = next;
			// The server has it now, so the crash mat isn't holding anything the
			// server isn't.
			clearDraft(draftKey);
			saveState = 'saved';
		} catch {
			// Offline or the request died. Leave `saved` alone so the next
			// change (or the next visibility flush) tries again.
			saveState = 'idle';
		} finally {
			inFlight = false;
			if (queuedAgain) {
				queuedAgain = false;
				persist();
			}
		}
	}

	function addTag() {
		const t = tagInput.trim().toLowerCase().replace(/^#/, '');
		if (t && !tags.some((x) => x.name === t)) tags = [...tags, { id: null, name: t }];
		tagInput = '';
	}

	function removeTag(index: number) {
		tags = tags.filter((_, i) => i !== index);
	}

	function startEditTag(index: number) {
		editingTagIndex = index;
		editTagValue = tags[index].name;
		tagError = '';
	}

	function cancelEditTag() {
		editingTagIndex = null;
		tagError = '';
	}

	async function commitEditTag() {
		const index = editingTagIndex;
		if (index === null) return;
		const name = editTagValue.trim().toLowerCase().replace(/^#/, '');
		const tag = tags[index];

		if (!name) {
			removeTag(index);
			editingTagIndex = null;
			return;
		}
		if (name === tag.name) {
			editingTagIndex = null;
			return;
		}
		if (tags.some((t, i) => i !== index && t.name === name)) {
			tagError = 'Already tagged';
			return;
		}

		if (tag.id) {
			const res = await fetch(`/api/tags/${tag.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name })
			});
			if (!res.ok) {
				tagError = res.status === 409 ? 'Already tagged' : 'Could not rename';
				return;
			}
		}

		tags = tags.map((t, i) => (i === index ? { ...t, name } : t));
		editingTagIndex = null;
		tagError = '';
	}

	function focusAndSelect(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	async function togglePin() {
		pinned = !pinned;
	}

	/** Going back shouldn't cost you the sentence you were in the middle of —
	 *  but it shouldn't wait on the network either. The request outlives this
	 *  component, and the local draft covers it if it doesn't. */
	function leaveEditor() {
		persist();
		goto('/');
	}

	async function deleteNote() {
		if (!id) {
			goto('/');
			return;
		}
		deleting = true;
		await fetch(`/api/notes/${id}`, { method: 'DELETE' });
		goto('/');
	}
</script>

<div class="safe-top safe-bottom mx-auto flex min-h-screen max-w-2xl flex-col px-4 pb-10">
	<header
		class="sticky top-0 z-10 -mx-4 flex items-center justify-between px-3 py-3"
		style="background: var(--color-bg);"
	>
		<button
			onclick={leaveEditor}
			aria-label="Back"
			class="flex h-9 w-9 items-center justify-center rounded-full"
			style="color: var(--color-ink-muted);"
		>
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"
				stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg
			>
		</button>

		<span class="text-xs" style="color: var(--color-ink-faint);">
			{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}
		</span>

		<div class="flex items-center gap-1">
			<button
				onclick={togglePin}
				aria-label={pinned ? 'Unpin' : 'Pin'}
				aria-pressed={pinned}
				class="flex h-9 w-9 items-center justify-center rounded-full"
				style={`color: ${pinned ? 'var(--color-accent)' : 'var(--color-ink-muted)'};`}
			>
				<svg
					width="17"
					height="17"
					viewBox="0 0 24 24"
					fill={pinned ? 'currentColor' : 'none'}
					stroke="currentColor"
					stroke-width="1.8"
					><path
						d="M14.5 2.5a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4l-1.1 1.1a1 1 0 0 1-1.4 0l-.3-.3-3.2 3.2.7 2.9a1 1 0 0 1-.27.96l-.9.9a1 1 0 0 1-1.42 0l-3.6-3.6-4.6 4.6a1 1 0 0 1-1.42-1.42l4.6-4.6-3.6-3.6a1 1 0 0 1 0-1.42l.9-.9a1 1 0 0 1 .96-.27l2.9.7 3.2-3.2-.3-.3a1 1 0 0 1 0-1.4z"
					/></svg
				>
			</button>
			{#if id}
				<button
					onclick={deleteNote}
					disabled={deleting}
					aria-label="Delete note"
					class="flex h-9 w-9 items-center justify-center rounded-full"
					style="color: var(--color-ink-muted);"
				>
					<svg
						width="17"
						height="17"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path
							d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"
						/></svg
					>
				</button>
			{/if}
		</div>
	</header>

	{#if before.length > 0}
		<div class="mb-7 space-y-6">
			{#each before as thought (thought.id)}
				<Thought note={thought} href={`/note/${thought.id}`} />
			{/each}
		</div>
	{/if}

	<div bind:this={editorBlock} style="scroll-margin-top: 3.5rem;">
		{#if inThread && existingNote}
			<p class="mb-1.5 text-[0.72rem] font-bold tabular-nums" style="color: var(--color-accent);">
				{timeOfDay(existingNote.created_at)} · editing
			</p>
		{/if}

		{#if sourceUrl}
			<a
				href={sourceUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
				style="background: var(--color-surface-2); color: var(--color-ink-muted);"
			>
				<svg
					width="11"
					height="11"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.2"
					stroke-linecap="round"
					stroke-linejoin="round"
					><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path
						d="M15 3h6v6"
					/><path d="M10 14 21 3" /></svg
				>
				{hostname(sourceUrl)}
			</a>
		{/if}

		{#if linkImage || linkTitle || linkDescription}
			<a
				href={sourceUrl ?? undefined}
				target={sourceUrl ? '_blank' : undefined}
				rel={sourceUrl ? 'noopener noreferrer' : undefined}
				class="mb-4 flex gap-3 rounded-[var(--radius-lg)] p-3"
				style="background: var(--color-surface-2);"
			>
				{#if linkImage}
					<img
						src={linkImage}
						alt=""
						class="h-16 w-16 shrink-0 rounded-[var(--radius-sm)] object-cover"
						style="background: var(--color-surface);"
					/>
				{/if}
				<div class="min-w-0 flex-1">
					{#if linkTitle}
						<p class="truncate text-sm font-medium" style="color: var(--color-ink);">{linkTitle}</p>
					{/if}
					{#if linkDescription}
						<p
							class="mt-0.5 line-clamp-2 text-xs leading-snug"
							style="color: var(--color-ink-muted);"
						>
							{linkDescription}
						</p>
					{/if}
				</div>
			</a>
		{/if}

		<!--
		A textarea rather than an <input>: Chrome on Android offers password /
		credit-card / address autofill on single-line text inputs, which put a
		row of unwanted suggestions above the keyboard on every note. A
		textarea gets no such treatment, and it lets a long title wrap instead
		of scrolling sideways. `field-sizing: content` (layout.css) keeps it
		one line tall until it actually needs two.
	-->
		<textarea
			bind:value={title}
			rows="1"
			placeholder="Title"
			autocomplete="off"
			autocapitalize="sentences"
			enterkeyhint="next"
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					editor?.focusEditor();
				}
			}}
			class="mb-1.5 w-full resize-none overflow-hidden bg-transparent font-serif font-semibold tracking-tight outline-none"
			class:text-xl={!inThread}
			class:text-[1.02rem]={inThread}
			style="color: var(--color-ink);"></textarea>

		<MarkdownEditor bind:this={editor} bind:value={content} bind:focused={editorFocused} />
	</div>

	<div
		bind:this={toolbarBar}
		class="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-1.5 px-4 pt-2 pb-2"
		style="background: var(--color-bg); border-top: 1px solid var(--color-border);"
	>
		{#if showToolbar}
			<EditorToolbar onaction={(action) => editor?.applyFormat(action)} />
		{:else}
			{#each tags as tag, i (tag.id ?? `new-${i}`)}
				{#if editingTagIndex === i}
					<span
						class="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
						style="background: var(--color-accent-soft);"
					>
						<input
							type="text"
							bind:value={editTagValue}
							use:focusAndSelect
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									commitEditTag();
								} else if (e.key === 'Escape') {
									e.preventDefault();
									cancelEditTag();
								}
							}}
							onblur={commitEditTag}
							class="w-16 bg-transparent outline-none"
							style="color: var(--color-accent);"
						/>
					</span>
				{:else}
					<span
						class="flex items-center gap-1 rounded-full py-1 pr-1.5 pl-2.5 text-xs"
						style="background: var(--color-accent-soft); color: var(--color-accent);"
					>
						<button
							onclick={() => startEditTag(i)}
							class="max-w-32 truncate"
							aria-label={`Edit tag ${tag.name}`}
						>
							#{tag.name}
						</button>
						<button
							onclick={() => removeTag(i)}
							aria-label={`Remove tag ${tag.name}`}
							class="flex h-3.5 w-3.5 items-center justify-center opacity-70"
						>
							<span aria-hidden="true">×</span>
						</button>
					</span>
				{/if}
			{/each}
			{#if tagError}
				<span class="text-xs" style="color: var(--color-danger);">{tagError}</span>
			{/if}
			<input
				type="text"
				bind:value={tagInput}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ',') {
						e.preventDefault();
						addTag();
					}
				}}
				onblur={addTag}
				placeholder={tags.length ? 'Add tag' : 'Add tags…'}
				class="min-w-20 flex-1 bg-transparent py-1 text-xs outline-none"
				style="color: var(--color-ink-muted);"
			/>
		{/if}
	</div>

	{#if after.length > 0}
		<div class="mt-7 space-y-6">
			{#each after as thought (thought.id)}
				<Thought note={thought} href={`/note/${thought.id}`} />
			{/each}
		</div>
	{/if}

	<!--
		Adding always lands at the end of the thread, never "under" whichever
		thought you happen to have open — so it reads the same whether you got
		here from the first thought or the fifth.
	-->
	{#if existingNote}
		<button
			type="button"
			class="mt-7 flex items-center gap-2 self-start rounded-full py-2 pr-4 pl-3 text-[0.82rem] font-bold active:scale-95"
			style="background: var(--color-accent-soft); color: var(--color-accent);"
			onclick={() => {
				writeInto(stubOf(thread[0] ?? existingNote));
				goto('/');
			}}
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="3"
				stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg
			>
			Add a thought
		</button>
	{/if}
</div>
