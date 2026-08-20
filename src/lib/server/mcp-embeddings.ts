import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { env } from '$env/dynamic/private';

type EmbeddingResponse = {
	embedding?: unknown;
	indexed?: unknown;
	failed?: unknown;
	error?: unknown;
};

export type SemanticEmbedding = {
	embedding: number[];
	indexed: number;
	failed: number;
};

/**
 * Generate the query embedding and lazily bring the token owner's stale note
 * embeddings current. The raw MCP token only crosses this service-to-service
 * request; the Edge Function rejects anything not carrying the service key.
 */
export async function semanticEmbedding(token: string, query: string): Promise<SemanticEmbedding> {
	const serviceKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? '';
	if (!serviceKey) {
		throw new Error('Semantic search is unavailable: SUPABASE_SECRET_KEY is not configured');
	}

	const response = await fetch(`${PUBLIC_SUPABASE_URL}/functions/v1/mcp-embeddings`, {
		method: 'POST',
		headers: {
			apikey: serviceKey,
			'content-type': 'application/json'
		},
		body: JSON.stringify({ token, query }),
		signal: AbortSignal.timeout(120_000)
	});
	const payload = (await response.json().catch(() => ({}))) as EmbeddingResponse;

	if (!response.ok) {
		throw new Error(
			typeof payload.error === 'string'
				? payload.error
				: `Semantic embedding service failed (${response.status})`
		);
	}

	if (
		!Array.isArray(payload.embedding) ||
		payload.embedding.length !== 384 ||
		!payload.embedding.every((value) => typeof value === 'number' && Number.isFinite(value))
	) {
		throw new Error('Semantic embedding service returned an invalid vector');
	}

	return {
		embedding: payload.embedding as number[],
		indexed: typeof payload.indexed === 'number' ? payload.indexed : 0,
		failed: typeof payload.failed === 'number' ? payload.failed : 0
	};
}
