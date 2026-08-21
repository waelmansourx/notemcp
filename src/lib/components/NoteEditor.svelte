<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import EditorToolbar from '$lib/components/EditorToolbar.svelte';
	import { timeOfDay } from '$lib/dates';
	import { clearDraft, isNewerThan, pruneDrafts, readDraft, saveDraft } from '$lib/draft.svelte';
	import { addPending, asNote, isPending, settlePending } from '$lib/stream.svelte';
	import { queueNote, queueEdit, removeEdit, removeFromOutbox, syncEntry } from '$lib/outbox';
	import { ImageAttachments } from '$lib/composer/image-attachments.svelte';
	import { LinkPreview } from '$lib/composer/link-preview.svelte';
	import { normalizeTagName } from '$lib/tags';
	import { showToast } from '$lib/toast.svelte';
	import { takeEditorHandoff } from '$lib/editor-handoff';
	import Thought from './Thought.svelte';
	import AttachmentTray from './AttachmentTray.svelte';
	import LinkPreviewCard from './LinkPreviewCard.svelte';
	import VoiceNote from './VoiceNote.svelte';
	import type { Note } from '$lib/types';

	let {
		existingNote = null,
		prefill = null,
		thread = [],
		handoffKey = null
	}: {
		existingNote?: Note | null;
		/** Every thought in this thread, oldest first, including this one. */
		thread?: Note[];
		handoffKey?: string | null;
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
	const link = new LinkPreview();
	let pinned = $state(existingNote?.pinned ?? false);
	let createParentId = $state<string | null>(null);
	let tags = $state<{ id: string | null; name: string }[]>(
		existingNote?.tags.map((t) => ({ id: t.id, name: t.name })) ?? []
	);
	let tagInput = $state('');
	let editingTagIndex = $state<number | null>(null);
	let editTagValue = $state('');
	let tagError = $state('');
	let saveState = $state<'idle' | 'saving' | 'saved' | 'queued'>('idle');
	let deleting = $state(false);
	let confirmingDelete = $state(false);

	let editor = $state<ReturnType<typeof MarkdownEditor> | null>(null);
	let editorFocused = $state(false);
	const editedVoiceNotes = new Set<string>();
	let editorPhotoInput = $state<HTMLInputElement | null>(null);
	let editorPhotoBusy = $state(false);
	let editorPhotoError = $state<string | null>(null);
	const editorPhotos = new ImageAttachments();
	let adoptedHandoff = false;

	onMount(() => {
		if (!handoffKey || existingNote) return;
		const handoff = takeEditorHandoff(handoffKey);
		if (!handoff) return;
		adoptedHandoff = true;
		content = handoff.content;
		tags = handoff.tags.map((name) => ({ id: null, name }));
		createParentId = handoff.parentId;
		sourceUrl = handoff.sourceUrl;
		linkTitle = handoff.sourceTitle;
		linkDescription = handoff.sourceDescription;
		linkImage = handoff.sourceImage;
		syncLinkController();
	});

	function syncLinkController() {
		link.restore({
			url: sourceUrl,
			title: linkTitle,
			description: linkDescription,
			image: linkImage
		});
	}
	syncLinkController();

	async function handleLinkPaste(url: string) {
		const pending = link.fetch(url);
		sourceUrl = link.url;
		linkTitle = null;
		linkDescription = null;
		linkImage = null;
		await pending;
		if (link.url !== url) return;
		sourceUrl = link.url;
		linkTitle = link.title;
		linkDescription = link.description;
		linkImage = link.image;
	}

	function removeLinkPreview() {
		link.clear();
		sourceUrl = null;
		linkTitle = null;
		linkDescription = null;
		linkImage = null;
	}

	function pickEditorPhotos() {
		editorPhotoInput?.click();
	}

	function onEditorPhotosChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		attachEditorPhotos(files);
	}

	async function attachEditorPhotos(files: File[]) {
		const images = files.filter((file) => file.type.startsWith('image/')).slice(0, 10);
		if (images.length === 0 || editorPhotoBusy) return;
		editorPhotoBusy = true;
		editorPhotoError = null;
		editorPhotos.clear();
		editorPhotos.attach(images);
		await editorPhotos.waitForUploads();
		const ids = editorPhotos.items
			.filter((item) => item.mediaId && !item.uploadError)
			.map((item) => item.mediaId as string);
		if (ids.length > 0) editor?.insertBlock(ids.map((id) => `![](/api/media/${id})`).join('\n\n'));
		if (ids.length !== images.length) {
			editorPhotoError =
				ids.length > 0
					? "Some images couldn't be attached."
					: "Couldn't attach those images — use files under 25MB and try again.";
		}
		editorPhotos.clear();
		editorPhotoBusy = false;
	}

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

	type Snapshot = {
		title: string;
		content: string;
		pinned: boolean;
		tags: string;
		sourceUrl: string | null;
		sourceTitle: string | null;
		sourceDescription: string | null;
		sourceImage: string | null;
	};

	// \u0000 can't appear in a tag name, so joining on it can't collide.
	const TAG_SEP = '\u0000';

	function snapshot(): Snapshot {
		return {
			title,
			content,
			pinned,
			tags: tags.map((t) => t.name).join(TAG_SEP),
			sourceUrl,
			sourceTitle: linkTitle,
			sourceDescription: linkDescription,
			sourceImage: linkImage
		};
	}

	/** The same shape, read off a note as the server sent it. */
	function snapshotOf(note: Note): Snapshot {
		return {
			title: note.title,
			content: note.content_markdown,
			pinned: note.pinned,
			tags: note.tags.map((t) => t.name).join(TAG_SEP),
			sourceUrl: note.source_url,
			sourceTitle: note.source_title,
			sourceDescription: note.source_description,
			sourceImage: note.source_image
		};
	}

	function same(a: Snapshot, b: Snapshot): boolean {
		return (
			a.title === b.title &&
			a.content === b.content &&
			a.pinned === b.pinned &&
			a.tags === b.tags &&
			a.sourceUrl === b.sourceUrl &&
			a.sourceTitle === b.sourceTitle &&
			a.sourceDescription === b.sourceDescription &&
			a.sourceImage === b.sourceImage
		);
	}

	/*
	 * What the server last confirmed, for every thought in the thread — not
	 * just the one the page happened to load with.
	 *
	 * `threadItems` holds what's on screen, which after an edit runs ahead of
	 * the server; this holds what's actually stored. Keeping the two apart is
	 * what lets a peer thought be edited at all. With only one copy, tapping
	 * back into a thought you'd just changed either showed you the stale
	 * server text — losing the edit, and re-sending the stale copy on your
	 * next keystroke — or made the editor believe the server already had your
	 * changes and never send them, depending on which of the two that single
	 * copy was.
	 *
	 * Deliberately not $state: a record of the server, not something the UI
	 * renders, and keeping it out of the graph stops the autosave effect from
	 * re-running on its own result.
	 */
	const serverState = new Map<string, Snapshot>();
	for (const item of thread) serverState.set(item.id, snapshotOf(item));
	if (existingNote && !serverState.has(existingNote.id)) {
		serverState.set(existingNote.id, snapshotOf(existingNote));
	}

	let saved: Snapshot | null = existingNote ? (serverState.get(existingNote.id) ?? null) : null;
	// Stable for the life of this editor — and across a refresh while a composer
	// handoff is still in the URL — so a new note can recover its local draft.
	const clientId = handoffKey ?? crypto.randomUUID();
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
			tags: tags.map((t) => t.name),
			sourceUrl: next.sourceUrl,
			sourceTitle: next.sourceTitle,
			sourceDescription: next.sourceDescription,
			sourceImage: next.sourceImage,
			parentId: createParentId
		});

		const timer = setTimeout(persist, AUTOSAVE_MS);
		return () => clearTimeout(timer);
	});

	/**
	 * Fold what's in the editor back into the thread list.
	 *
	 * `threadItems` is what the peer cards render from and what `switchTo`
	 * reads when you tap back into a thought, so an edit that lived only in
	 * the editor's own fields was reverted the moment you moved off it. This
	 * is what keeps a thought you changed looking changed — before the
	 * network has confirmed anything, and whether or not it ever does.
	 */
	/** A tag typed into the editor has no id until the server assigns one, but
	 *  a Note's tags are typed as having one and the peer cards key on it.
	 *  `local:` fills the gap and is stripped again on the way back out — a
	 *  tag carrying one has never been stored, so it must not be mistaken for
	 *  something `/api/tags/:id` could rename. */
	const LOCAL_TAG = 'local:';

	function editableTags(note: Note): { id: string | null; name: string }[] {
		return note.tags.map((t) => ({
			id: t.id?.startsWith(LOCAL_TAG) ? null : t.id,
			name: t.name
		}));
	}

	function commitToThread(
		noteId: string | null,
		values: {
			title: string;
			content: string;
			pinned: boolean;
			tags: { id: string | null; name: string }[];
			sourceUrl: string | null;
			sourceTitle: string | null;
			sourceDescription: string | null;
			sourceImage: string | null;
		}
	) {
		if (!noteId) return;
		threadItems = threadItems.map((n) =>
			n.id === noteId
				? {
						...n,
						title: values.title,
						content_markdown: values.content,
						pinned: values.pinned,
						source_url: values.sourceUrl,
						source_title: values.sourceTitle,
						source_description: values.sourceDescription,
						source_image: values.sourceImage,
						tags: values.tags.map((t) => ({ id: t.id ?? LOCAL_TAG + t.name, name: t.name }))
					}
				: n
		);
	}

	function markVoiceEdited() {
		if (id && activeNote?.voice_note) editedVoiceNotes.add(id);
	}

	/** Adopt a late transcript only while this editor still holds the exact
	 * empty body it loaded. The database performs the same updated_at guard,
	 * and this local guard protects keystrokes that have not autosaved yet. */
	function acceptVoiceTranscript(transcript: string) {
		if (!id || !activeNote?.voice_note || editorFocused || editedVoiceNotes.has(id)) return;
		const base = serverState.get(id);
		if (!base || base.content !== '' || content !== '') return;

		const confirmed = { ...base, content: transcript };
		content = transcript;
		saved = confirmed;
		serverState.set(id, confirmed);
		commitToThread(id, {
			title,
			content: transcript,
			pinned,
			tags,
			sourceUrl,
			sourceTitle: linkTitle,
			sourceDescription: linkDescription,
			sourceImage: linkImage
		});
	}

	/*
	 * Recover anything a previous visit didn't manage to send — but exactly
	 * once, on mount, and deliberately outside the reactive graph. An effect
	 * that both reads the note's text and writes it re-runs on every keystroke,
	 * and would race the autosave effect for the same localStorage key: one
	 * writing the draft, the other deciding it was redundant and deleting it.
	 *
	 * Every thought in the thread is checked, not just the one the page loaded
	 * with: an unsent edit to a peer is exactly as real as an unsent edit to
	 * this one, and only looking at `existingNote` meant a thought you'd
	 * changed offline came back showing the server's copy with no sign the
	 * change had ever happened.
	 */
	onMount(() => {
		pruneDrafts();
		if (!existingNote && !adoptedHandoff) {
			const draft = readDraft(clientId);
			if (draft) {
				title = draft.title;
				content = draft.content;
				tags = draft.tags.map((name) => ({ id: null, name }));
				if (draft.sourceUrl !== undefined) sourceUrl = draft.sourceUrl;
				if (draft.sourceTitle !== undefined) linkTitle = draft.sourceTitle;
				if (draft.sourceDescription !== undefined) linkDescription = draft.sourceDescription;
				if (draft.sourceImage !== undefined) linkImage = draft.sourceImage;
				if (draft.parentId !== undefined) createParentId = draft.parentId;
			}
		}
		syncLinkController();

		const recovered = new Map<
			string,
			{
				title: string;
				content: string;
				tags: string[];
				sourceUrl?: string | null;
				sourceTitle?: string | null;
				sourceDescription?: string | null;
				sourceImage?: string | null;
			}
		>();
		for (const item of threadItems) {
			const server = serverState.get(item.id);
			if (!server) continue;

			const draft = readDraft(item.id);
			if (!draft) continue;

			// Compared against the server's copy, never against what's on
			// screen — by the time this runs the two can already differ.
			const stale = !isNewerThan(draft, item.updated_at);
			const redundant =
				draft.content === server.content &&
				draft.title === server.title &&
				(draft.sourceUrl === undefined || draft.sourceUrl === server.sourceUrl) &&
				(draft.sourceTitle === undefined || draft.sourceTitle === server.sourceTitle) &&
				(draft.sourceDescription === undefined ||
					draft.sourceDescription === server.sourceDescription) &&
				(draft.sourceImage === undefined || draft.sourceImage === server.sourceImage);
			if (stale || redundant) {
				clearDraft(item.id);
				continue;
			}
			recovered.set(item.id, draft);
		}

		if (recovered.size === 0) return;

		// One pass, so the list isn't reassigned underneath its own iteration.
		threadItems = threadItems.map((n) => {
			const draft = recovered.get(n.id);
			return draft
				? {
						...n,
						title: draft.title,
						content_markdown: draft.content,
						source_url: draft.sourceUrl === undefined ? n.source_url : draft.sourceUrl,
						source_title: draft.sourceTitle === undefined ? n.source_title : draft.sourceTitle,
						source_description:
							draft.sourceDescription === undefined
								? n.source_description
								: draft.sourceDescription,
						source_image: draft.sourceImage === undefined ? n.source_image : draft.sourceImage,
						tags: draft.tags.map((name) => ({ id: LOCAL_TAG + name, name }))
					}
				: n;
		});

		const mine = id ? recovered.get(id) : undefined;
		if (mine) {
			title = mine.title;
			content = mine.content;
			tags = mine.tags.map((name) => ({ id: null, name }));
			if (mine.sourceUrl !== undefined) sourceUrl = mine.sourceUrl;
			if (mine.sourceTitle !== undefined) linkTitle = mine.sourceTitle;
			if (mine.sourceDescription !== undefined) linkDescription = mine.sourceDescription;
			if (mine.sourceImage !== undefined) linkImage = mine.sourceImage;
			syncLinkController();
		}
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
		const persistingTags = tags.map((t) => ({ id: t.id, name: t.name }));
		// The snapshot this write is measured against — `saved` belongs to
		// whatever is on screen, which a mid-flight switch can change.
		const base = saved;

		// Built before the request so the failure paths can queue exactly what
		// didn't make it, rather than guessing at it afterwards.
		const patch: Record<string, unknown> = {};
		if (persistingId) {
			if (!base || base.title !== next.title) patch.title = next.title;
			if (!base || base.content !== next.content) patch.content_markdown = next.content;
			if (!base || base.pinned !== next.pinned) patch.pinned = next.pinned;
			if (!base || base.sourceUrl !== next.sourceUrl) {
				patch.source_url = next.sourceUrl;
				patch.source_type = next.sourceUrl ? 'share' : 'manual';
			}
			if (!base || base.sourceTitle !== next.sourceTitle) patch.source_title = next.sourceTitle;
			if (!base || base.sourceDescription !== next.sourceDescription) {
				patch.source_description = next.sourceDescription;
			}
			if (!base || base.sourceImage !== next.sourceImage) patch.source_image = next.sourceImage;
			// Sending tagNames rewrites every note_tags row for this note, so
			// it only goes out when the tags themselves have changed.
			if (!base || base.tags !== next.tags) patch.tagNames = persistingTags.map((t) => t.name);
		}

		/** Is the thought this write was started for still the one on screen?
		 *  A tap on a peer mid-request means the answer applies to a note the
		 *  editor's fields no longer describe. */
		function stillActive() {
			return id === persistingId;
		}
		// Set once a successful create has handed its new id to the editor —
		// after which `stillActive()` can no longer recognise itself.
		let adopted = false;

		/* Couldn't reach the server. The words are already in the draft, but a
		   draft is only a crash mat — something has to actually send them, or
		   "saved locally" quietly means "lost". Queue the write so the next app
		   open retries it, exactly like a capture that was made offline. */
		function queueForLater() {
			if (persistingId) {
				if (Object.keys(patch).length > 0) queueEdit(persistingId, patch);
			} else {
				// Same client id the POST used, so a retry resolves to the row
				// the failed attempt may already have written.
				queueNote({
					client_id: clientId,
					title: next.title,
					content_markdown: next.content,
					source_url: next.sourceUrl,
					source_type: next.sourceUrl ? 'share' : 'manual',
					source_title: next.sourceTitle,
					source_description: next.sourceDescription,
					source_image: next.sourceImage,
					parent_id: createParentId,
					tagNames: persistingTags.map((t) => t.name)
				});
			}
			// Only speak for the thought actually on screen.
			if (stillActive()) saveState = 'queued';
		}

		try {
			if (!persistingId) {
				const res = await fetch('/api/notes', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						client_id: clientId,
						title: next.title,
						content_markdown: next.content,
						source_url: next.sourceUrl,
						source_type: next.sourceUrl ? 'share' : 'manual',
						source_title: next.sourceTitle,
						source_description: next.sourceDescription,
						source_image: next.sourceImage,
						parent_id: createParentId,
						pinned: next.pinned,
						tagNames: persistingTags.map((t) => t.name)
					})
				});
				if (!res.ok) {
					queueForLater();
					return;
				}
				const note = await res.json();
				// The draft moves with the note: it was filed under the client id
				// until the server gave us a real one.
				clearDraft(clientId);
				// An earlier attempt may have queued this note; it's real now.
				removeFromOutbox(clientId);
				serverState.set(note.id, next);
				// Only claim the new id if this is still the note on screen —
				// switching away mid-request must not stamp its id onto
				// whatever's active now.
				if (stillActive()) {
					id = note.id;
					history.replaceState(history.state, '', `/note/${id}`);
					// Checked again below against the id we've just adopted, so
					// this has to be recorded before it changes.
					adopted = true;
				}
				// If we already handed this note to the stream on the way out,
				// give that copy the real id so it stops reading as unsynced,
				// regardless of what's on screen now.
				settlePending(clientId, note.id);
			} else {
				// The PATCH answers with the whole note, tags included — which is
				// where a tag typed here finally gets a real id.
				let confirmed: Note | null = null;
				if (Object.keys(patch).length > 0) {
					const res = await fetch(`/api/notes/${persistingId}`, {
						method: 'PATCH',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(patch)
					});
					if (!res.ok) {
						queueForLater();
						return;
					}
					confirmed = await res.json().catch(() => null);
				}

				const confirmedTags = confirmed?.tags?.map((t) => ({ id: t.id, name: t.name }));
				// Only trust them if they're still the tags we sent — the user
				// can have added one while the request was out.
				const tagsUnchanged =
					confirmedTags && confirmedTags.map((t) => t.name).join(TAG_SEP) === next.tags;

				// The server is now here, whichever thought is on screen — so
				// record it against the note this write was actually for, drop
				// any earlier attempt still queued for it, and let go of the
				// crash mat, which is no longer holding anything the server
				// isn't. All keyed to the outgoing note, never to `id`.
				serverState.set(persistingId, next);
				removeEdit(persistingId);
				clearDraft(persistingDraftKey);
				commitToThread(persistingId, {
					title: next.title,
					content: next.content,
					pinned: next.pinned,
					tags: tagsUnchanged ? confirmedTags! : persistingTags,
					sourceUrl: next.sourceUrl,
					sourceTitle: next.sourceTitle,
					sourceDescription: next.sourceDescription,
					sourceImage: next.sourceImage
				});
				// Swapping the real ids in lets a tag that was just created be
				// renamed without a reload. Safe against re-triggering autosave:
				// the snapshot only compares names, which haven't moved.
				if (stillActive() && tagsUnchanged) tags = confirmedTags!;
			}

			// Same guard as the id above: if a switch happened mid-request,
			// `saved`/`title`/`content` now belong to a different thought, and
			// stamping this response's snapshot over them would make the note
			// actually on screen look saved when it isn't.
			if (adopted || stillActive()) {
				saved = next;
				saveState = 'saved';
			} else {
				// The header describes whatever is on screen now, and this
				// answer was about something else.
				saveState = 'idle';
			}
		} catch {
			// Offline or the request died. `saved` is left alone so the next
			// change still reads as unsent, and the write is queued so it
			// doesn't depend on there being a next change.
			queueForLater();
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

		// Hold on to what's in the editor before its fields get overwritten —
		// both locally, so the card for the thought we're leaving shows what
		// you actually typed, and on the wire. persist() reads `id`
		// synchronously before its first await, so it's guaranteed to save the
		// outgoing thought, not the one we're about to switch to.
		commitToThread(id, {
			title,
			content,
			pinned,
			tags,
			sourceUrl,
			sourceTitle: linkTitle,
			sourceDescription: linkDescription,
			sourceImage: linkImage
		});
		persist();

		id = target.id;
		title = target.title;
		content = target.content_markdown;
		sourceUrl = target.source_url;
		linkTitle = target.source_title;
		linkDescription = target.source_description;
		linkImage = target.source_image;
		syncLinkController();
		pinned = target.pinned;
		tags = editableTags(target);
		/*
		 * What the *server* has for this thought — never `snapshot()`, which
		 * reads the fields we just loaded.
		 *
		 * Those fields come from `threadItems`, which carries local edits that
		 * may not have gone out yet. Treating them as the saved state was the
		 * bug that made editing a peer thought pointless: switch away, switch
		 * back, and the editor concluded the server already had your changes,
		 * so autosave had nothing to send and the edit was never written.
		 * Falling back to null means "we don't know what's stored" — which
		 * sends everything, the safe direction to be wrong in.
		 */
		saved = serverState.get(target.id) ?? null;

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
	const addPhotos = new ImageAttachments({ maxCount: 1, onPrepared: () => addTextarea?.focus() });
	let addBusy = $state(false);

	// The same crash mat every other composer in this app gets: written to
	// localStorage on every change, synchronously, so a backgrounded tab or a
	// tap on Back doesn't cost you the continuation you were mid-sentence on.
	// Keyed to the thread's root rather than whichever thought is open, since
	// that's what a continuation always attaches to regardless (see
	// addThought/buildAddContent below) — the same id whether you typed it
	// looking at the first thought or the fifth.
	const addDraftKey = `thread-add:${threadItems[0]?.id ?? existingNote?.id ?? clientId}`;

	onMount(() => {
		const draft = readDraft(addDraftKey);
		if (draft?.content) addText = draft.content;
	});

	$effect(() => {
		const content = addText;
		if (!content.trim()) clearDraft(addDraftKey);
		else saveDraft(addDraftKey, { title: '', content, tags: [] });
	});

	let addHasContent = $derived(addText.trim().length > 0 || addPhotos.items.length > 0);

	function pickAddPhoto() {
		addPhotoInput?.click();
	}

	function onAddPhotoChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		addPhotos.clear();
		addPhotos.attach([file]);
	}

	function clearAddPhoto() {
		addPhotos.clear();
	}

	function buildAddContent(): string {
		const parts: string[] = [];
		const image = addPhotos.markdown();
		if (image) parts.push(image);
		const t = addText.trim();
		if (t) parts.push(t);
		return parts.join('\n\n');
	}

	async function addThought() {
		if (!addHasContent || addBusy) return;
		addBusy = true;

		await addPhotos.waitForIds();

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
		clearDraft(addDraftKey);
		clearAddPhoto();
		addBusy = false;
		queueMicrotask(() => addTextarea?.focus());

		syncEntry(
			entry,
			(serverId) => {
				threadItems = threadItems.map((n) =>
					n.client_id === entry.client_id ? { ...n, id: serverId } : n
				);
				// It's a real note now, so it can be tapped into and edited —
				// which needs a record of what the server has for it.
				serverState.set(serverId, {
					title: entry.title,
					content: entry.content_markdown,
					pinned: false,
					tags: entry.tagNames.join(TAG_SEP),
					sourceUrl: null,
					sourceTitle: null,
					sourceDescription: null,
					sourceImage: null
				});
			},
			() => showToast('Saved on this device — will sync', { duration: 2600 })
		);
	}

	function addTag() {
		const t = normalizeTagName(tagInput);
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
		const name = normalizeTagName(editTagValue);
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
	 *  component, and the outbox covers it if it doesn't.
	 *
	 *  A note being written for the first time is queued on the way out and
	 *  also handed to the stream's pending list: queued because the POST is
	 *  still in flight and closing the tab now would otherwise take the note
	 *  with it, and pending because the load we're navigating to would come
	 *  back without it and the note would appear to have gone nowhere for a
	 *  round trip or two. persist() drops it from the queue once the server
	 *  answers, and the client id is shared, so the two can't become two
	 *  notes. */
	function leaveEditor() {
		const unsent = !id && (title.trim() || content.trim());
		if (unsent) {
			addPending(
				queueNote({
					client_id: clientId,
					title,
					content_markdown: content,
					source_url: sourceUrl,
					source_type: sourceUrl ? 'share' : 'manual',
					source_title: linkTitle,
					source_description: linkDescription,
					source_image: linkImage,
					parent_id: createParentId,
					tagNames: tags.map((t) => t.name)
				})
			);
		}
		persist();
		goto('/');
	}

	function requestDelete() {
		confirmingDelete = true;
	}

	async function deleteNote() {
		if (!id) {
			goto('/');
			return;
		}
		deleting = true;
		try {
			const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				showToast("Couldn't delete that note — try again", { duration: 3000 });
				return;
			}
			goto('/');
		} catch {
			showToast("Couldn't delete that note — check your connection", { duration: 3000 });
		} finally {
			deleting = false;
			confirmingDelete = false;
		}
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

		<!-- "Saved on this device" is the honest version of what's happened when
		     the network write didn't land: the words are on the disk and queued
		     to sync, which is worth saying rather than showing nothing and
		     letting it read as lost. -->
		<span class="text-xs" style="color: var(--color-ink-faint);">
			{saveState === 'saving'
				? 'Syncing…'
				: saveState === 'saved'
					? 'Synced'
					: saveState === 'queued'
						? 'Saved on this device'
						: ''}
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
			{#if id && confirmingDelete}
				<div class="flex items-center gap-1">
					<button
						type="button"
						disabled={deleting}
						class="h-8 rounded-full px-2.5 text-xs font-semibold"
						style="color: var(--color-ink-muted);"
						onclick={() => (confirmingDelete = false)}>Cancel</button
					>
					<button
						type="button"
						disabled={deleting}
						class="h-8 rounded-full px-3 text-xs font-bold disabled:opacity-50"
						style="background: var(--color-danger-soft); color: var(--color-danger);"
						onclick={deleteNote}>{deleting ? 'Deleting…' : 'Delete'}</button
					>
				</div>
			{:else if id}
				<button
					type="button"
					onclick={requestDelete}
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
				<Thought note={thought} href={null} onnavigate={isPending(thought) ? null : switchTo} />
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

		<LinkPreviewCard preview={link} onremove={removeLinkPreview} class="mb-4" />

		{#if activeNote?.voice_note}
			<VoiceNote
				noteId={activeNote.id}
				voice={activeNote.voice_note}
				class="mb-4"
				ontranscript={acceptVoiceTranscript}
			/>
		{/if}

		<MarkdownEditor
			bind:this={editor}
			bind:value={content}
			bind:focused={editorFocused}
			onlinkpaste={handleLinkPaste}
			onimages={attachEditorPhotos}
			onchange={markVoiceEdited}
		/>
		{#if editorPhotoError}
			<p class="mt-2 text-xs" style="color: var(--color-danger);">{editorPhotoError}</p>
		{/if}

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
							<svg
								width="10"
								height="10"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg
							>
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
				class="bg-transparent px-1 py-0.5 text-xs font-medium outline-none"
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
			<EditorToolbar
				onaction={(action) => editor?.applyFormat(action)}
				onphoto={pickEditorPhotos}
				photoBusy={editorPhotoBusy}
			/>
			<input
				bind:this={editorPhotoInput}
				type="file"
				accept="image/*"
				multiple
				class="hidden"
				onchange={onEditorPhotosChosen}
			/>
		</div>
	{/if}

	{#if after.length > 0}
		<div class="mt-3 space-y-3">
			{#each after as thought (thought.id)}
				<Thought note={thought} href={null} onnavigate={isPending(thought) ? null : switchTo} />
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
			<AttachmentTray attachments={addPhotos} />

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
				}}></textarea>

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
