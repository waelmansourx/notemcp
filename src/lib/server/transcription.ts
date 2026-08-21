import { env } from '$env/dynamic/private';
import { presignGet } from '$lib/server/r2';
import { supabaseAdmin } from '$lib/server/supabase-admin';

const DEFAULT_API_BASE = 'https://api.assemblyai.com';
const AUDIO_URL_TTL_SECONDS = 60 * 60;

type ProviderStatus = 'queued' | 'processing' | 'completed' | 'error';

interface AssemblyTranscript {
	id: string;
	status: ProviderStatus;
	text?: string | null;
	error?: string | null;
	language_code?: string | null;
}

function apiBase(): string {
	return (env.ASSEMBLYAI_API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, '');
}

function apiKey(): string {
	if (!env.ASSEMBLYAI_API_KEY) throw new Error('ASSEMBLYAI_API_KEY is not configured');
	return env.ASSEMBLYAI_API_KEY;
}

export function webhookSecret(): string {
	if (!env.ASSEMBLYAI_WEBHOOK_SECRET) {
		throw new Error('ASSEMBLYAI_WEBHOOK_SECRET is not configured');
	}
	return env.ASSEMBLYAI_WEBHOOK_SECRET;
}

function providerError(payload: unknown, fallback: string): string {
	if (payload && typeof payload === 'object' && 'error' in payload) {
		const value = (payload as { error?: unknown }).error;
		if (typeof value === 'string' && value.trim()) return value.slice(0, 2_000);
	}
	return fallback;
}

async function providerRequest(path: string, init?: RequestInit): Promise<AssemblyTranscript> {
	const response = await fetch(`${apiBase()}${path}`, {
		...init,
		headers: {
			authorization: apiKey(),
			...(init?.body ? { 'content-type': 'application/json' } : {}),
			...init?.headers
		},
		signal: AbortSignal.timeout(20_000)
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(providerError(payload, `AssemblyAI request failed (${response.status})`));
	}
	return payload as AssemblyTranscript;
}

function one<T>(value: T | T[] | null | undefined): T | null {
	return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/**
 * Submit a committed R2 voice object. Repeated calls are idempotent while a
 * job is active or complete; failed jobs can be explicitly retried.
 */
export async function startVoiceTranscription(
	noteId: string,
	userId: string,
	requestOrigin: string
): Promise<void> {
	const admin = supabaseAdmin();
	const { data, error } = await admin
		.from('voice_notes')
		.select(
			'note_id, transcription_status, provider_transcript_id, media:media!voice_notes_media_id_fkey(r2_key, status, kind)'
		)
		.eq('note_id', noteId)
		.eq('user_id', userId)
		.maybeSingle();

	if (error || !data) throw new Error(error?.message ?? 'Voice note not found');
	if (
		(data.transcription_status === 'processing' || data.transcription_status === 'complete') &&
		data.provider_transcript_id
	) {
		return;
	}

	const media = one(data.media as any) as { r2_key: string; status: string; kind: string } | null;
	if (!media || media.kind !== 'audio' || media.status !== 'committed') {
		throw new Error('The R2 audio upload has not completed');
	}

	try {
		const audioUrl = await presignGet(media.r2_key, AUDIO_URL_TTL_SECONDS);
		const configuredWebhook = env.ASSEMBLYAI_WEBHOOK_URL?.trim();
		const webhookUrl =
			configuredWebhook || new URL('/api/webhooks/assemblyai', requestOrigin).toString();

		const submitted = await providerRequest('/v2/transcript', {
			method: 'POST',
			body: JSON.stringify({
				audio_url: audioUrl,
				speech_models: ['universal-3-pro', 'universal-2'],
				language_detection: true,
				language_detection_options: {
					code_switching: true,
					code_switching_confidence_threshold: 0.3
				},
				format_text: true,
				punctuate: true,
				webhook_url: webhookUrl,
				webhook_auth_header_name: 'x-notemcp-webhook-secret',
				webhook_auth_header_value: webhookSecret()
			})
		});

		if (!submitted.id) throw new Error('AssemblyAI did not return a transcript id');

		const { error: updateError } = await admin
			.from('voice_notes')
			.update({
				transcription_status: 'processing',
				provider_transcript_id: submitted.id,
				error: null,
				submitted_at: new Date().toISOString(),
				completed_at: null
			})
			.eq('note_id', noteId)
			.eq('user_id', userId);
		if (updateError) throw updateError;
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : 'Could not start transcription';
		await admin
			.from('voice_notes')
			.update({ transcription_status: 'failed', error: message.slice(0, 2_000) })
			.eq('note_id', noteId)
			.eq('user_id', userId);
		throw cause;
	}
}

/** Fetch the full provider result and reconcile it into the durable voice row. */
export async function finishVoiceTranscription(transcriptId: string): Promise<void> {
	const admin = supabaseAdmin();
	const { data: voice, error: findError } = await admin
		.from('voice_notes')
		.select('note_id, user_id, note_updated_at_at_capture')
		.eq('provider_transcript_id', transcriptId)
		.maybeSingle();
	if (findError) throw findError;
	// An old/deleted job is already reconciled. A 2xx stops pointless retries.
	if (!voice) return;

	const transcript = await providerRequest(`/v2/transcript/${encodeURIComponent(transcriptId)}`);
	if (transcript.status === 'queued' || transcript.status === 'processing') {
		throw new Error('AssemblyAI webhook arrived before the transcript became terminal');
	}

	const completed = transcript.status === 'completed';
	const rawText = completed && typeof transcript.text === 'string' ? transcript.text.trim() : null;
	const error = completed
		? null
		: providerError(transcript, 'AssemblyAI could not transcribe this recording');

	const { error: voiceError } = await admin
		.from('voice_notes')
		.update({
			transcription_status: completed ? 'complete' : 'failed',
			raw_text: rawText,
			error,
			language_code: transcript.language_code ?? null,
			completed_at: new Date().toISOString()
		})
		.eq('note_id', voice.note_id)
		.eq('provider_transcript_id', transcriptId);
	if (voiceError) throw voiceError;

	if (!rawText) return;

	// Optimistic concurrency is the edit guard: this exact timestamp was
	// captured when the empty voice thought was created. Any user PATCH changes
	// it, making this update match zero rows instead of overwriting their text.
	const { error: noteError } = await admin
		.from('notes')
		.update({ content_markdown: rawText })
		.eq('id', voice.note_id)
		.eq('user_id', voice.user_id)
		.eq('updated_at', voice.note_updated_at_at_capture)
		.eq('content_markdown', '');
	if (noteError) throw noteError;
}
