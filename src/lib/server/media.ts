// Kept out of the routes so both /api/media (issue) and /api/media/[id]
// (confirm/read) agree on what a valid upload looks like.

const IMAGE_TYPES: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/heic': 'heic'
};

const AUDIO_TYPES: Record<string, string> = {
	'audio/webm': 'webm',
	'audio/mp4': 'm4a',
	'audio/mpeg': 'mp3',
	'audio/ogg': 'ogg'
};

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export type MediaKind = 'image' | 'audio';

/** Extension for a mime type if it's one we accept for the given kind, else null. */
export function extensionFor(kind: MediaKind, mimeType: string): string | null {
	const table = kind === 'image' ? IMAGE_TYPES : AUDIO_TYPES;
	return table[mimeType] ?? null;
}

export function maxBytesFor(kind: MediaKind): number {
	return kind === 'image' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
}
