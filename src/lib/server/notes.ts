import type { SupabaseClient } from '@supabase/supabase-js';
import type { Note } from '$lib/types';

const NOTE_SELECT = '*, note_tags(tags(id, name))';

function normalize(row: any): Note {
	const { note_tags, ...rest } = row;
	return {
		...rest,
		tags: (note_tags ?? []).map((nt: any) => nt.tags).filter(Boolean)
	};
}

export async function setNoteTags(
	supabase: SupabaseClient,
	userId: string,
	noteId: string,
	tagNames: string[]
) {
	const names = [...new Set(tagNames.map((t) => t.trim().toLowerCase()).filter(Boolean))];

	await supabase.from('note_tags').delete().eq('note_id', noteId);

	if (names.length === 0) return;

	const { data: existing } = await supabase
		.from('tags')
		.select('id, name')
		.eq('user_id', userId)
		.in('name', names);

	const existingNames = new Set((existing ?? []).map((t) => t.name));
	const toCreate = names.filter((n) => !existingNames.has(n));

	let created: { id: string; name: string }[] = [];
	if (toCreate.length > 0) {
		const { data } = await supabase
			.from('tags')
			.insert(toCreate.map((name) => ({ user_id: userId, name })))
			.select('id, name');
		created = data ?? [];
	}

	const all = [...(existing ?? []), ...created];
	await supabase
		.from('note_tags')
		.insert(all.map((t) => ({ note_id: noteId, tag_id: t.id })));
}

export async function createNote(
	supabase: SupabaseClient,
	userId: string,
	input: {
		title?: string;
		content_markdown?: string;
		source_url?: string | null;
		source_type?: string | null;
		source_title?: string | null;
		source_description?: string | null;
		source_image?: string | null;
		pinned?: boolean;
		tagNames?: string[];
	}
): Promise<Note> {
	const { data, error } = await supabase
		.from('notes')
		.insert({
			user_id: userId,
			title: input.title ?? '',
			content_markdown: input.content_markdown ?? '',
			source_url: input.source_url ?? null,
			source_type: input.source_type ?? null,
			source_title: input.source_title ?? null,
			source_description: input.source_description ?? null,
			source_image: input.source_image ?? null,
			pinned: input.pinned ?? false
		})
		.select('*')
		.single();

	if (error || !data) throw error;

	if (input.tagNames && input.tagNames.length > 0) {
		await setNoteTags(supabase, userId, data.id, input.tagNames);
	}

	const { data: full } = await supabase.from('notes').select(NOTE_SELECT).eq('id', data.id).single();
	return normalize(full);
}
