import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

type PendingDocument = {
	id: string;
	content_hash: string;
	input: string;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = (() => {
	try {
		const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
		if (keys.default) return keys.default;
	} catch {
		// Fall through to the legacy key while projects migrate.
	}
	return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
})();
const model = new Supabase.ai.Session('gte-small');

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
	const headers: Record<string, string> = {
		apikey: SERVICE_ROLE_KEY,
		'content-type': 'application/json'
	};
	if (!SERVICE_ROLE_KEY.startsWith('sb_secret_')) {
		headers.authorization = `Bearer ${SERVICE_ROLE_KEY}`;
	}

	const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
		method: 'POST',
		headers,
		body: JSON.stringify(body)
	});

	if (!response.ok) {
		throw new Error(`${name} failed (${response.status}): ${await response.text()}`);
	}

	return (await response.json()) as T;
}

async function embedding(input: string): Promise<number[]> {
	const output = await model.run(input, { mean_pool: true, normalize: true });
	if (!Array.isArray(output) || output.length !== 384) {
		throw new Error('gte-small returned an invalid embedding');
	}
	return output as number[];
}

async function mapWithConcurrency<T>(
	items: PendingDocument[],
	concurrency: number,
	worker: (item: PendingDocument) => Promise<T>
): Promise<PromiseSettledResult<T>[]> {
	const results: PromiseSettledResult<T>[] = new Array(items.length);
	let cursor = 0;

	async function run() {
		while (cursor < items.length) {
			const index = cursor++;
			try {
				results[index] = { status: 'fulfilled', value: await worker(items[index]) };
			} catch (reason) {
				results[index] = { status: 'rejected', reason };
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
	return results;
}

Deno.serve(async (request: Request) => {
	if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
	if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
		return Response.json({ error: 'Function environment is incomplete' }, { status: 500 });
	}

	// This endpoint receives raw NoteMCP tokens. Only the application server,
	// authenticated with the project service key, may invoke it.
	if (request.headers.get('apikey') !== SERVICE_ROLE_KEY) {
		return Response.json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = (await request.json()) as { token?: unknown; query?: unknown };
		const token = typeof body.token === 'string' ? body.token : '';
		const query = typeof body.query === 'string' ? body.query.trim() : '';
		if (!token || !query) {
			return Response.json({ error: 'token and query are required' }, { status: 400 });
		}

		const pending = await rpc<PendingDocument[]>('mcp_list_pending_embeddings', {
			p_token: token,
			p_limit: 200
		});

		const stored = await mapWithConcurrency(pending, 6, async (document) => {
			const vector = await embedding(document.input);
			return rpc<{ stored: boolean }>('mcp_store_note_embedding', {
				p_token: token,
				p_note_id: document.id,
				p_content_hash: document.content_hash,
				p_embedding: vector
			});
		});

		const failed = stored.filter((result) => result.status === 'rejected').length;
		const indexed = stored.filter(
			(result) => result.status === 'fulfilled' && result.value.stored
		).length;

		return Response.json({
			embedding: await embedding(query),
			indexed,
			failed
		});
	} catch (error) {
		console.error(error);
		return Response.json(
			{ error: error instanceof Error ? error.message : 'Embedding request failed' },
			{ status: 500 }
		);
	}
});
