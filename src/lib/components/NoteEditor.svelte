<script lang="ts">
	import { goto } from '$app/navigation';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import { TASK_ITEM_RE } from '$lib/markdown';
	import { hostname } from '$lib/dates';
	import type { Note } from '$lib/types';

	let {
		existingNote = null,
		prefill = null
	}: {
		existingNote?: Note | null;
		prefill?: {
			title?: string;
			content_markdown?: string;
			source_url?: string | null;
			source_title?: string | null;
			source_description?: string | null;
			source_image?: string | null;
		} | null;
	} = $props();

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

	let ready = false;
	$effect(() => {
		title;
		content;
		pinned;
		tags.map((t) => t.name).join(',');
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
					source_title: linkTitle,
					source_description: linkDescription,
					source_image: linkImage,
					pinned,
					tagNames: tags.map((t) => t.name)
				})
			});
			const note = await res.json();
			id = note.id;
			history.replaceState(history.state, '', `/note/${id}`);
		} else {
			await fetch(`/api/notes/${id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title,
					content_markdown: content,
					pinned,
					tagNames: tags.map((t) => t.name)
				})
			});
		}
		saveState = 'saved';
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

	let isChecklist = $derived(
		content.trim().length > 0 &&
			content
				.split('\n')
				.filter((l) => l.trim())
				.every((l) => TASK_ITEM_RE.test(l))
	);

	function toggleChecklist() {
		const lines = content.split('\n');
		if (isChecklist) {
			content = lines.map((l) => l.replace(TASK_ITEM_RE, '')).join('\n');
		} else {
			const next = lines.map((l) => (l.trim() && !TASK_ITEM_RE.test(l) ? `- [ ] ${l.trim()}` : l));
			content = next.join('\n').trim() || '- [ ] ';
		}
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
	<header
		class="sticky top-0 z-10 -mx-4 flex items-center justify-between px-3 py-3"
		style="background: var(--color-bg);"
	>
		<button
			onclick={() => goto('/')}
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
			<button
				onclick={toggleChecklist}
				aria-label={isChecklist ? 'Turn off checklist' : 'Turn into checklist'}
				aria-pressed={isChecklist}
				class="flex h-9 w-9 items-center justify-center rounded-full"
				style={isChecklist
					? 'background: var(--color-accent-soft); color: var(--color-accent);'
					: 'color: var(--color-ink-muted);'}
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
					><path d="m4 6 1.5 1.5L8.5 4M4 12l1.5 1.5L8.5 10M4 18l1.5 1.5L8.5 16" /><path
						d="M12 6h8M12 12h8M12 18h8"
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

	<input
		type="text"
		bind:value={title}
		placeholder="Title"
		class="mb-1.5 w-full bg-transparent text-xl font-semibold tracking-tight outline-none"
		style="color: var(--color-ink);"
	/>

	<MarkdownEditor bind:value={content} />

	<div
		class="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-1.5 px-4 pt-2 pb-2"
		style="background: var(--color-bg);"
	>
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
	</div>
</div>
