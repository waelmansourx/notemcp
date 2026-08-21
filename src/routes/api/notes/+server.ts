import { json, error } from '@sveltejs/kit';
import { createNote, type VoiceNoteInput } from '$lib/server/notes';
import { startVoiceTranscription } from '$lib/server/transcription';
import type { RequestHandler } from './$types';

function parseVoice(value: unknown): VoiceNoteInput | null {
	if (value == null) return null;
	if (!value || typeof value !== 'object') throw error(400, 'voice must be an object');
	const voice = value as Record<string, unknown>;
	const mediaId = typeof voice.media_id === 'string' ? voice.media_id : '';
	const durationMs = Number(voice.duration_ms);
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mediaId)) {
		throw error(400, 'voice.media_id must be a UUID');
	}
	if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 86_400_000) {
		throw error(400, 'voice.duration_ms is invalid');
	}
	const waveform = Array.isArray(voice.waveform)
		? voice.waveform
				.slice(0, 64)
				.map(Number)
				.filter(Number.isFinite)
				.map((level) => Math.max(0, Math.min(100, Math.round(level))))
		: [];
	return { media_id: mediaId, duration_ms: Math.round(durationMs), waveform };
}

export const POST: RequestHandler = async ({ request, url, locals: { supabase, user } }) => {
	if (!user) throw error(401, 'Not authenticated');

	const body = await request.json();
	const voice = parseVoice(body.voice);

	const note = await createNote(supabase, user.id, {
		title: body.title,
		content_markdown: body.content_markdown,
		source_url: body.source_url,
		source_type: voice ? 'voice' : body.source_type,
		source_title: body.source_title,
		source_description: body.source_description,
		source_image: body.source_image,
		parent_id: typeof body.parent_id === 'string' ? body.parent_id : null,
		pinned: body.pinned,
		tagNames: body.tagNames,
		client_id: typeof body.client_id === 'string' ? body.client_id : null,
		voice
	});

	if (voice && note.voice_note?.transcription_status !== 'complete') {
		// Saving the recording must not depend on the enrichment provider. The
		// voice thought is already durable in R2 + Postgres; a provider/config
		// failure is recorded on its transcription row and can be retried.
		await startVoiceTranscription(note.id, user.id, url.origin).catch(() => {});
	}

	return json(note, { status: 201 });
};
