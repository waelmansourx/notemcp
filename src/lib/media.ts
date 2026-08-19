// Uploads a photo or audio recording straight to R2: ask the server to sign
// a PUT URL (POST /api/media), PUT the bytes there directly, then confirm
// (PUT /api/media/[id]). The signing step alone is a small JSON round trip —
// fast enough to embed `/api/media/{id}` in a note the moment it resolves,
// so a note never has to carry the raw bytes (as base64) just because the
// upload itself hasn't finished yet. If signing fails outright (offline, R2
// down), there's no id to embed and the caller drops the image rather than
// falling back to base64.
export type MediaKind = 'image' | 'audio';

export interface UploadedMedia {
	id: string;
	/** Owner-only; resolves to a fresh short-lived R2 URL on each request. */
	url: string;
}

export interface PendingMedia {
	id: string;
	/** Resolves once the bytes have actually landed in R2 and the row is committed. */
	whenUploaded: Promise<UploadedMedia>;
}

export async function beginMediaUpload(blob: Blob, kind: MediaKind): Promise<PendingMedia> {
	const signRes = await fetch('/api/media', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ kind, mimeType: blob.type, byteSize: blob.size })
	});
	if (!signRes.ok) throw new Error(`Could not start ${kind} upload`);
	const { id, uploadUrl } = await signRes.json();

	const whenUploaded = (async () => {
		const putRes = await fetch(uploadUrl, {
			method: 'PUT',
			headers: { 'content-type': blob.type },
			body: blob
		});
		if (!putRes.ok) throw new Error(`${kind} upload to storage failed`);

		const confirmRes = await fetch(`/api/media/${id}`, { method: 'PUT' });
		if (!confirmRes.ok) throw new Error(`Could not confirm ${kind} upload`);
		return confirmRes.json() as Promise<UploadedMedia>;
	})();

	return { id, whenUploaded };
}
