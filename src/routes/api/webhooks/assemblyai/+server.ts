import { error } from '@sveltejs/kit';
import { finishVoiceTranscription, webhookSecret } from '$lib/server/transcription';
import type { RequestHandler } from './$types';

async function sameSecret(received: string, expected: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const [receivedHash, expectedHash] = await Promise.all([
		crypto.subtle.digest('SHA-256', encoder.encode(received)),
		crypto.subtle.digest('SHA-256', encoder.encode(expected))
	]);
	const a = new Uint8Array(receivedHash);
	const b = new Uint8Array(expectedHash);
	let difference = 0;
	for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
	return difference === 0;
}

export const POST: RequestHandler = async ({ request }) => {
	const received = request.headers.get('x-notemcp-webhook-secret') ?? '';
	if (!(await sameSecret(received, webhookSecret()))) throw error(401, 'Invalid webhook secret');

	const payload = await request.json().catch(() => null);
	const transcriptId =
		payload && typeof payload.transcript_id === 'string' ? payload.transcript_id : '';
	if (!transcriptId) throw error(400, 'transcript_id is required');

	await finishVoiceTranscription(transcriptId);
	return new Response(null, { status: 204 });
};
