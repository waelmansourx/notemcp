<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import EditorToolbar from '$lib/components/EditorToolbar.svelte';
	import { hostname, timeOfDay } from '$lib/dates';
	import { clearDraft, isNewerThan, pruneDrafts, readDraft, saveDraft } from '$lib/draft.svelte';
	import { addPending, asNote, isPending, settlePending } from '$lib/stream.svelte';
	import { queueNote, syncEntry } from '$lib/outbox';
	import { beginMediaUpload, type PendingMedia } from '$lib/media';
	import { normalizeTagName } from '$lib/tags';
	import { showToast } from '$lib/toast.svelte';
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
	let id = $state(existingNote?.id ?? null);

	// A local, mutable copy: this component stays mounted while you move
	// between peer thoughts (see switchTo below) or add a new one to the end,
	// and `thread` only ever arrives fresh via a real remount (the route's
	// `{#key}` on the note id), so seeding once here is exactly right.
	let threadItems = $state<Note[]>(thread);

	let position = $derived(id ? threadItems.findIndex((t) => t.id === id) : -1);
	let before = $derived(position > 0 ? threadItems.slice(0, position) : []);
	let after = $derived(position >= 0 ? threadItems.slice(position + 1) : []);
	let inThread = $derived(threadItems.length > 1);
	/** The thought actually open in the editor below — differs from
	 *  `existingNote`, the one this page first loaded with, once a peer in
	 *  the thread has been tapped (see switchTo). */
	let activeNote = $derived(threadItems.find((t) => t.id === id) ?? existingNote);

	// Opening the fourth thought shouldn't dump you at the first one. The
	// editor is scrolled to the top of the viewport once, on mount, so you
	// land on what you tapped and the earlier thoughts are simply above you.
	let editorBlock = $state<HTMLDivElement | null>(null);
	onMount(() => {
		if (before.length === 0 || !editorBlock) return;
		editorBlock.scrollIntoView({ block: 'start' });
	});

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

		// Read once, synchronously: `id` can change out from under this async
		// function if the user taps a peer thought (switchTo) while this save
		// is still in flight, and the write below has to land on the note it
		// was actually started for — never on whatever's active by the time
		// the network comes back.
		const persistingId = id;
		const persistingDraftKey = draftKey;

		try {
			if (!persistingId) {
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
				// Only claim the new id if this is still the note on screen —
				// switching away mid-request must not stamp its id onto
				// whatever's active now.
				if (id === persistingId) {
					id = note.id;
					history.replaceState(history.state, '', `/note/${id}`);
				}
				// If we already handed this note to the stream on the way out,
				// give that copy the real id so it stops reading as unsynced,
				// regardless of what's on screen now.
				settlePending(clientId, note.id);
			} else {
				const body: Record<string, unknown> = {};
				if (!saved || saved.title !== next.title) body.title = next.title;
				if (!saved || saved.content !== next.content) body.content_markdown = next.content;
				if (!saved || saved.pinned !== next.pinned) body.pinned = next.pinned;
				// Sending tagNames rewrites every note_tags row for this note, so
				// it only goes out when the tags themselves have changed.
				if (!saved || saved.tags !== next.tags) body.tagNames = tags.map((t) => t.name);

				if (Object.keys(body).length > 0) {
					const res = await fetch(`/api/notes/${persistingId}`, {
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

			// Same guard as the id above: if a switch happened mid-request,
			// `saved`/`title`/`content` now belong to a different thought, and
			// stamping this response's snapshot over them would make the note
			// actually on screen look saved when it isn't.
			if (id === persistingId) {
				saved = next;
				// The server has it now, so the crash mat isn't holding anything
				// the server isn't.
				clearDraft(persistingDraftKey);
			}
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

	/**
	 * Move to a peer thought without leaving the page.
	 *
	 * Every member of this thread already arrived with the initial load
	 * (`+page.server.ts` fetches the whole thing, not just this note's
	 * children), so switching which one is open is just swapping which
	 * fields the editor is bound to — never a fetch, never a navigation.
	 * `history.replaceState` keeps the URL honest (refresh, share, bookmark
	 * all still land on the right thought) without SvelteKit treating it as
	 * a route change, which is what would otherwise remount this component
	 * and reset your scroll position on every tap.
	 */
	function switchTo(targetId: string, coords?: { x: number; y: number }) {
		if (targetId === id) {
			editor?.focusEditor(coords);
			return;
		}
		const target = threadItems.find((t) => t.id === targetId);
		if (!target) {
			// Not part of this thread — shouldn't happen (every Thought this
			// component renders comes from threadItems itself), but a real
			// navigation is a safe fallback over silently doing nothing.
			goto(`/note/${targetId}`);
			return;
		}

		// Flush whatever's mid-sentence on the thought we're leaving before its
		// fields get overwritten. persist() reads `id` synchronously before its
		// first await, so this is guaranteed to save the outgoing thought, not
		// the one we're about to switch to.
		persist();

		id = target.id;
		title = target.title;
		content = target.content_markdown;
		sourceUrl = target.source_url;
		linkTitle = target.source_title;
		linkDescription = target.source_description;
		linkImage = target.source_image;
		pinned = target.pinned;
		tags = target.tags.map((t) => ({ id: t.id, name: t.name }));
		saved = snapshot();

		history.replaceState(history.state, '', `/note/${target.id}`);
		queueMicrotask(() => {
			editor?.focusEditor(coords);
		});
	}

	/* ---------------- adding a thought without leaving ----------------

	   This used to be a button that attached the thread to the *global*
	   composer and navigated to the stream to use it — so continuing the
	   thing you were just reading meant leaving it. The note page never had
	   its own way to write; every other page borrows the composer mounted
	   there. This is that composer, boiled down to what a continuation
	   actually needs (text, optionally a photo) and inlined at the end of
	   the thread it's continuing, so sending it lands the new thought right
	   here without going anywhere.
	*/
	let addText = $state('');
	let addTextarea = $state<HTMLTextAreaElement | null>(null);
	let addPhotoInput = $state<HTMLInputElement | null>(null);
	let addPhotoDataUrl = $state<string | null>(null);
	let addPhotoMediaId = $state<string | null>(null);
	let addPhotoUploadStart = $state<Promise<PendingMedia> | null>(null);
	let addPhotoUploadError = $state(false);
	let addPhotoTooLarge = $state(false);
	let addBusy = $state(false);
	const MAX_ADD_PHOTO_BYTES = 4 * 1024 * 1024;

	let addHasContent = $derived(addText.trim().length > 0 || Boolean(addPhotoDataUrl));

	function pickAddPhoto() {
		addPhotoInput?.click();
	}

	function onAddPhotoChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		addPhotoTooLarge = file.size > MAX_ADD_PHOTO_BYTES;
		if (addPhotoTooLarge) return;

		addPhotoMediaId = null;
		addPhotoUploadError = false;
		const reader = new FileReader();
		reader.onload = () => (addPhotoDataUrl = reader.result as string);
		reader.readAsDataURL(file);

		const started = beginMediaUpload(file, 'image');
		addPhotoUploadStart = started;
		started
			.then(({ id: mediaId, whenUploaded }) => {
				if (addPhotoUploadStart !== started) return; // superseded by a later pick/clear
				addPhotoMediaId = mediaId;
				whenUploaded.catch(() => {
					if (addPhotoUploadStart !== started) return;
					addPhotoMediaId = null;
					addPhotoUploadError = true;
				});
			})
			.catch(() => {
				if (addPhotoUploadStart === started) addPhotoUploadError = true;
			});
	}

	function clearAddPhoto() {
		addPhotoDataUrl = null;
		addPhotoMediaId = null;
		addPhotoUploadStart = null;
		addPhotoUploadError = false;
		addPhotoTooLarge = false;
	}

	function buildAddContent(): string {
		const parts: string[] = [];
		if (addPhotoMediaId) parts.push(`![](/api/media/${addPhotoMediaId})`);
		const t = addText.trim();
		if (t) parts.push(t);
		return parts.join('\n\n');
	}

	async function addThought() {
		if (!addHasContent || addBusy) return;
		addBusy = true;

		if (addPhotoDataUrl && !addPhotoMediaId && addPhotoUploadStart && !addPhotoUploadError) {
			await addPhotoUploadStart.catch(() => {});
		}

		const content = buildAddContent();
		if (!content) {
			addBusy = false;
			return;
		}

		// A continuation always hangs off the head of the thread, never off
		// whichever thought happens to be open — it reads the same whether you
		// added it from the first thought or the fifth. See thread.ts.
		const root = threadItems[0] ?? activeNote;
		const inheritedTags = (root?.tags ?? []).map((t) => t.name);

		const entry = queueNote({
			title: '',
			content_markdown: content,
			source_url: null,
			source_type: null,
			source_title: null,
			source_description: null,
			source_image: null,
			parent_id: root?.id ?? id,
			tagNames: inheritedTags.map(normalizeTagName).filter(Boolean)
		});

		// Appears in the thread immediately — the POST is already on its way,
		// and there's nothing here worth making the reader wait for.
		threadItems = [...threadItems, asNote(entry)];

		addText = '';
		clearAddPhoto();
		addBusy = false;
		queueMicrotask(() => addTextarea?.focus());

		syncEntry(
			entry,
			(serverId) => {
				threadItems = threadItems.map((n) =>
					n.client_id === entry.client_id ? { ...n, id: serverId } : n
				);
			},
			() => showToast('Saved on this device — will sync', { duration: 2600 })
		);
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
	 *  component, and the local draft covers it if it doesn't.
	 *
	 *  A note being written for the first time also goes into the stream's
	 *  pending list on the way out: the POST is still in flight, so the load
	 *  we're navigating to would come back without it and the note would
	 *  appear to have gone nowhere for a round trip or two. */
	function leaveEditor() {
		const unsent = !id && (title.trim() || content.trim());
		persist();
		if (unsent) {
			addPending({
				client_id: clientId,
				title,
				content_markdown: content,
				source_url: sourceUrl,
				source_type: sourceUrl ? 'share' : 'manual',
				source_title: linkTitle,
				source_description: linkDescription,
				source_image: linkImage,
				parent_id: null,
				tagNames: tags.map((t) => t.name),
				queued_at: new Date().toISOString()
			});
		}
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
		<div class="mb-3 space-y-3">
			{#each before as thought (thought.id)}
				<Thought
					note={thought}
					href={null}
					onnavigate={isPending(thought) ? null : switchTo}
				/>
			{/each}
		</div>
	{/if}

	<!--
		The card the peer thoughts above and below (Thought.svelte) already
		wear, so the one you're actually editing reads as the same kind of
		thing as its neighbours — a stack of equal cards, not a document with
		"replies" hanging off it. The `view-transition-name` is what an entry
		in the stream (Entry.svelte) morphs into: tapping a note grows it into
		this card instead of navigating away from the stream to a new page.
	-->
	<div
		bind:this={editorBlock}
		class="cursor-text rounded-[var(--radius-lg)] p-4"
		style="scroll-margin-top: 3.5rem; background: var(--color-surface); {activeNote?.id
			? `view-transition-name: note-${activeNote.id};`
			: ''}"
		onclick={(e) => {
			const target = e.target as HTMLElement;
			if (target.closest('button') || target.closest('a') || target.closest('input')) return;
			editor?.focusEditor({ x: e.clientX, y: e.clientY });
		}}
		role="presentation"
	>
		{#if inThread && activeNote}
			<p class="mb-2 text-[0.72rem] font-bold tabular-nums" style="color: var(--color-accent);">
				{timeOfDay(activeNote.created_at)} · editing
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

		<MarkdownEditor bind:this={editor} bind:value={content} bind:focused={editorFocused} />

		<!-- Tags placed cleanly inside the card footer -->
		<div class="mt-3 flex flex-wrap items-center gap-1.5 pt-1">
			{#each tags as tag, i (tag.id ?? `new-${i}`)}
				{#if editingTagIndex === i}
					<span
						class="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
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
							class="w-16 bg-transparent text-xs font-bold outline-none"
							style="color: var(--color-accent);"
						/>
					</span>
				{:else}
					<span
						class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.78rem] font-bold"
						style="background: var(--color-surface-2);"
					>
						<button
							onclick={() => startEditTag(i)}
							class="max-w-32 truncate"
							style="color: var(--color-accent);"
							aria-label={`Edit tag ${tag.name}`}
						>
							#{tag.name}
						</button>
						<button
							onclick={() => removeTag(i)}
							aria-label={`Remove tag ${tag.name}`}
							class="flex h-3.5 w-3.5 items-center justify-center opacity-60 hover:opacity-100"
							style="color: var(--color-ink-muted);"
						>
							<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
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
				placeholder={tags.length ? '+ Tag' : '+ Add tag'}
				class="bg-transparent py-0.5 px-1 text-xs font-medium outline-none"
				style="color: var(--color-ink-muted);"
			/>
		</div>
	</div>

	{#if showToolbar}
		<div
			bind:this={toolbarBar}
			class="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-1.5 px-4 pt-2 pb-2"
			style="background: var(--color-bg);"
		>
			<EditorToolbar onaction={(action) => editor?.applyFormat(action)} />
		</div>
	{/if}

	{#if after.length > 0}
		<div class="mt-3 space-y-3">
			{#each after as thought (thought.id)}
				<Thought
					note={thought}
					href={null}
					onnavigate={isPending(thought) ? null : switchTo}
				/>
			{/each}
		</div>
	{/if}

	<!--
		Adding always lands at the end of the thread, never "under" whichever
		thought you happen to have open — so it reads the same whether you got
		here from the first thought or the fifth. It also lands right here,
		inline, rather than sending you off to find a composer somewhere else:
		reaching the end of a thread is exactly when you'd want to add to it.
	-->
	{#if activeNote}
		<div
			class="mt-7 flex flex-col gap-2 rounded-[var(--radius-lg)] p-3"
			style="background: var(--color-surface-2);"
		>
			{#if addPhotoDataUrl}
				<div class="relative inline-block w-fit">
					<img
						src={addPhotoDataUrl}
						alt=""
						class="h-20 w-20 rounded-[var(--radius-lg)] object-cover"
						style="background: var(--color-surface);"
					/>
					<button
						type="button"
						aria-label="Remove photo"
						class="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full text-[10px]"
						style="background: var(--color-ink); color: var(--color-bg);"
						onclick={clearAddPhoto}
					>
						✕
					</button>
				</div>
			{/if}
			{#if addPhotoTooLarge}
				<p class="text-[0.78rem]" style="color: var(--color-danger);">
					That photo's too large to attach right now (4MB max).
				</p>
			{/if}
			{#if addPhotoUploadError}
				<p class="text-[0.78rem]" style="color: var(--color-danger);">
					Couldn't upload that photo — check your connection and try again.
				</p>
			{/if}

			<textarea
				bind:this={addTextarea}
				bind:value={addText}
				placeholder="Add a thought…"
				rows="1"
				class="max-h-[38vh] w-full resize-none overflow-y-auto bg-transparent font-serif text-[1rem] leading-[1.44] tracking-[-0.015em] outline-none"
				onkeydown={(e) => {
					if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						addThought();
					}
				}}
			></textarea>

			<div class="flex items-center gap-2">
				<button
					type="button"
					aria-label="Photo"
					class="grid h-8 w-8 shrink-0 place-items-center rounded-full"
					style="background: var(--color-surface); color: var(--color-ink-2);"
					onclick={pickAddPhoto}
				>
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.9"
						stroke-linecap="round"
						stroke-linejoin="round"
						><rect x="3" y="4" width="18" height="16" rx="3" /><circle
							cx="8.5"
							cy="9.5"
							r="1.5"
						/><path d="M3 16l5-4 4 3 3-2 6 4" /></svg
					>
				</button>
				<input
					bind:this={addPhotoInput}
					type="file"
					accept="image/*"
					class="hidden"
					onchange={onAddPhotoChosen}
				/>

				<span class="flex-1"></span>

				<button
					type="button"
					disabled={!addHasContent || addBusy}
					class="flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[0.8rem] font-bold active:scale-95 disabled:opacity-40"
					style="background: var(--color-accent); color: var(--color-accent-ink);"
					onclick={addThought}
				>
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="3.4"
						stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg
					>
					Add
				</button>
			</div>
		</div>
	{/if}
</div>
