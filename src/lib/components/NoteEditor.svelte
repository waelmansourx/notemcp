<script lang="ts">
	import { goto } from '$app/navigation';
	import { renderMarkdown } from '$lib/markdown';
	import { hostname } from '$lib/dates';
	import type { Note } from '$lib/types';

	let {
		existingNote = null,
		prefill = null
	}: {
		existingNote?: Note | null;
		prefill?: { title?: string; content_markdown?: string; source_url?: string | null } | null;
	} = $props();

	let id = $state(existingNote?.id ?? null);
	let title = $state(existingNote?.title ?? prefill?.title ?? '');
	let content = $state(existingNote?.content_markdown ?? prefill?.content_markdown ?? '');
	let sourceUrl = $state(existingNote?.source_url ?? prefill?.source_url ?? null);
	let pinned = $state(existingNote?.pinned ?? false);
	let tags = $state<string[]>(existingNote?.tags.map((t) => t.name) ?? []);
	let tagInput = $state('');
	let showPreview = $state(false);
	let saveState = $state<'idle' | 'saving' | 'saved'>('idle');
	let deleting = $state(false);

	let ready = false;
	$effect(() => {
		title;
		content;
		pinned;
		tags.length;
		if (!ready) {
			ready = true;
			return;
		}
		const timer = setTimeout(persist, 600);
		return () => clearTimeout(timer);
	});

	async function persist() {
		if (!title.trim() && !content.trim()) return;
		saveState = 'saving';

		if (!id) {
			const res = await fetch('/api/notes', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title,
					content_markdown: content,
					source_url: sourceUrl,
					source_type: sourceUrl ? 'share' : 'manual',
					pinned,
					tagNames: tags
				})
			});
			const note = await res.json();
			id = note.id;
			history.replaceState(history.state, '', `/note/${id}`);
		} else {
			await fetch(`/api/notes/${id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title, content_markdown: content, pinned, tagNames: tags })
			});
		}
		saveState = 'saved';
	}

	function addTag() {
		const t = tagInput.trim().toLowerCase().replace(/^#/, '');
		if (t && !tags.includes(t)) tags = [...tags, t];
		tagInput = '';
	}

	function removeTag(t: string) {
		tags = tags.filter((x) => x !== t);
	}

	async function togglePin() {
		pinned = !pinned;
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
	<header class="sticky top-0 z-10 -mx-4 flex items-center justify-between px-3 py-3" style="background: var(--color-bg);">
		<button
			onclick={() => goto('/')}
			aria-label="Back"
			class="flex h-9 w-9 items-center justify-center rounded-full"
			style="color: var(--color-ink-muted);"
		>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
				><path d="m15 18-6-6 6-6" /></svg
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
				<svg width="17" height="17" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8"
					><path
						d="M14.5 2.5a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4l-1.1 1.1a1 1 0 0 1-1.4 0l-.3-.3-3.2 3.2.7 2.9a1 1 0 0 1-.27.96l-.9.9a1 1 0 0 1-1.42 0l-3.6-3.6-4.6 4.6a1 1 0 0 1-1.42-1.42l4.6-4.6-3.6-3.6a1 1 0 0 1 0-1.42l.9-.9a1 1 0 0 1 .96-.27l2.9.7 3.2-3.2-.3-.3a1 1 0 0 1 0-1.4z"
					/></svg
				>
			</button>
			<button
				onclick={() => (showPreview = !showPreview)}
				aria-pressed={showPreview}
				class="rounded-full px-3 py-1.5 text-xs font-medium"
				style={showPreview
					? 'background: var(--color-accent-soft); color: var(--color-accent);'
					: 'color: var(--color-ink-muted);'}
			>
				Preview
			</button>
			{#if id}
				<button
					onclick={deleteNote}
					disabled={deleting}
					aria-label="Delete note"
					class="flex h-9 w-9 items-center justify-center rounded-full"
					style="color: var(--color-ink-muted);"
				>
					<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
						><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z" /></svg
					>
				</button>
			{/if}
		</div>
	</header>

	{#if sourceUrl}
		<a
			href={sourceUrl}
			target="_blank"
			rel="noopener noreferrer"
			class="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
			style="background: var(--color-surface-2); color: var(--color-ink-muted);"
		>
			<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
				><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></svg
			>
			{hostname(sourceUrl)}
		</a>
	{/if}

	<input
		type="text"
		bind:value={title}
		placeholder="Title"
		class="mb-2 w-full bg-transparent text-2xl font-semibold tracking-tight outline-none"
		style="color: var(--color-ink);"
	/>

	{#if showPreview}
		<div class="prose-note pt-1 pb-10">
			{@html renderMarkdown(content) || '<p style="color: var(--color-ink-faint)">Nothing to preview yet.</p>'}
		</div>
	{:else}
		<textarea
			bind:value={content}
			placeholder="Write something…"
			rows="1"
			class="w-full flex-1 resize-none bg-transparent pt-1 pb-10 text-[1rem] leading-relaxed outline-none"
			style="color: var(--color-ink);"
		></textarea>
	{/if}

	<div class="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 px-4 pt-3 pb-2" style="background: var(--color-bg);">
		{#each tags as tag (tag)}
			<button
				onclick={() => removeTag(tag)}
				class="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
				style="background: var(--color-accent-soft); color: var(--color-accent);"
			>
				#{tag}
				<span aria-hidden="true">×</span>
			</button>
		{/each}
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
	</div>
</div>
