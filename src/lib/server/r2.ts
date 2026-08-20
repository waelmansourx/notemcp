import { AwsClient } from 'aws4fetch';
import { env } from '$env/dynamic/private';

// Presigned URLs so the SvelteKit server never touches file bytes — a photo
// or audio recording goes browser -> R2 directly on PUT, and R2 -> browser
// directly on GET. This route only ever mints and verifies signatures, which
// keeps large uploads off the Netlify function body/duration limits that a
// proxy-through-the-server route would inherit (see ADR-001).
const PRESIGN_TTL_SECONDS = 300;

function client(): AwsClient {
	if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
		throw new Error(
			'R2 is not configured — set R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY'
		);
	}
	return new AwsClient({
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
		service: 's3',
		region: 'auto'
	});
}

function bucket(): string {
	if (!env.R2_BUCKET) throw new Error('R2_BUCKET is not set');
	return env.R2_BUCKET;
}

function objectUrl(key: string): URL {
	const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket()}/${key}`);
	url.searchParams.set('X-Amz-Expires', String(PRESIGN_TTL_SECONDS));
	return url;
}

/**
 * A presigned PUT URL scoped to this exact key + content type. The client
 * must send the same Content-Type header it declared when asking for the
 * URL — that header is part of what's signed, so a mismatched upload is
 * rejected by R2 rather than silently mislabeling the object.
 */
export async function presignPut(key: string, contentType: string): Promise<string> {
	const signed = await client().sign(objectUrl(key), {
		method: 'PUT',
		headers: { 'content-type': contentType },
		aws: { signQuery: true }
	});
	return signed.url;
}

export async function presignGet(key: string): Promise<string> {
	const signed = await client().sign(objectUrl(key), {
		method: 'GET',
		aws: { signQuery: true }
	});
	return signed.url;
}

/** Fetch an object through a short-lived signature without exposing the URL. */
export async function getObject(key: string): Promise<Response> {
	const url = await presignGet(key);
	return fetch(url, { method: 'GET', signal: AbortSignal.timeout(15_000) });
}

/** Store a server-generated derivative such as an MCP-sized image preview. */
export async function putObject(key: string, contentType: string, body: Uint8Array): Promise<void> {
	const url = await presignPut(key, contentType);
	const payload = Uint8Array.from(body).buffer;
	const response = await fetch(url, {
		method: 'PUT',
		headers: { 'content-type': contentType },
		body: payload,
		signal: AbortSignal.timeout(15_000)
	});
	if (!response.ok) throw new Error(`R2 upload failed (${response.status})`);
}

/** True if the object actually landed in R2 — guards against confirming an upload that failed midway. */
export async function objectExists(key: string): Promise<boolean> {
	const signed = await client().sign(objectUrl(key), { method: 'HEAD', aws: { signQuery: true } });
	const res = await fetch(signed.url, { method: 'HEAD' });
	return res.ok;
}

export async function deleteObject(key: string): Promise<void> {
	const signed = await client().sign(objectUrl(key), {
		method: 'DELETE',
		aws: { signQuery: true }
	});
	await fetch(signed.url, { method: 'DELETE' });
}
