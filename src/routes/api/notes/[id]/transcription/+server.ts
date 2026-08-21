import { error, json } from '@sveltejs/kit';
import { startVoiceTranscription } from '$lib/server/transcription';
import type { VoiceNote } from '$lib/types';
import type { RequestHandler } from './$types';

function normalize(value: unknown): VoiceNote | null {
	const row = Array.isArray(value) ? value[0] : value;
	if (!row || typeof row !== 'object') return null;
	const voice = row as Record<string, unknown>;
	return {
		media_id: typeof voice.media_id === 'string' ? voice.media_id : null,
		duration_ms: typeof voice.duration_ms === 'number' ? voice.duration_ms : 0,
		waveform: Array.isArray(voice.waveform)
			? voice.waveform.filter((level): level is number => typeof level === 'number')
			: [],
		transcription_status:
			voice.transcription_status === 'processing' ||
			voice.transcription_status === 'complete' ||
			voice.transcription_status === 'failed'
				? voice.transcription_status
				: 'pending',
		raw_text: typeof voice.raw_text === 'string' ? voice.raw_text : null,
		error: typeof voice.error === 'string' ? voice.error : null,
		language_code: typeof voice.language_code === 'string' ? voice.language_code : null
	};
}

async function ownVoice(
	supabase: App.Locals['supabase'],
	userId: string,
	noteId: string
): Promise<VoiceNote | null> {
	const { data } = await supabase
		.from('voice_notes')
		.select('media_id, duration_ms, waveform, transcription_status, raw_text, error, language_code')
		.eq('note_id', noteId)
		.eq('user_id', userId)
		.maybeSingle();
	return normalize(data);
}

export const GET: RequestHandler = async ({ params, locals: { supabase, user } }) => {
	if (!user) throw error(401, 'Not authenticated');
	const voice = await ownVoice(supabase, user.id, params.id!);
	if (!voice) throw error(404, 'Voice note not found');
	return json(voice);
};

export const POST: RequestHandler = async ({ params, url, locals: { supabase, user } }) => {
	if (!user) throw error(401, 'Not authenticated');
	const voice = await ownVoice(supabase, user.id, params.id!);
	if (!voice) throw error(404, 'Voice note not found');

	try {
		await startVoiceTranscription(params.id!, user.id, url.origin);
	} catch (cause) {
		throw error(502, cause instanceof Error ? cause.message : 'Could not start transcription');
	}
	return json({ ok: true }, { status: 202 });
};
