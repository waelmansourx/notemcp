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

export interface CompressedImage {
	blob: Blob;
	width: number;
	height: number;
}

/**
 * Shrink camera photos and screenshots before they leave the device. Images
 * keep their aspect ratio, are capped at 2048px on the long edge, and are
 * encoded as WebP when the browser can produce a smaller file. If the browser
 * cannot decode a format (notably HEIC in some engines), the original is kept
 * so formats already accepted by the media API still work.
 */
export async function compressImage(
	input: Blob,
	{ maxEdge = 2048, maxBytes = 4 * 1024 * 1024 }: { maxEdge?: number; maxBytes?: number } = {}
): Promise<CompressedImage> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' });
	} catch {
		return { blob: input, width: 0, height: 0 };
	}

	const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) {
		bitmap.close();
		return { blob: input, width: bitmap.width, height: bitmap.height };
	}

	context.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();

	const encode = (quality: number) =>
		new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));

	let compressed: Blob | null = null;
	for (const quality of [0.84, 0.74, 0.62, 0.5]) {
		compressed = await encode(quality);
		if (!compressed || compressed.size <= maxBytes) break;
	}

	if (!compressed) return { blob: input, width, height };
	// Avoid re-encoding a small source into a larger file unless resizing was
	// necessary to keep its dimensions practical for note rendering.
	const apiAcceptsInput = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(
		input.type
	);
	const blob = scale < 1 || compressed.size < input.size || !apiAcceptsInput ? compressed : input;
	return { blob, width, height };
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
