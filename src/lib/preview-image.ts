type PreviewImageRow = {
	preview_image?: string | null;
	source_image?: string | null;
	source_url?: string | null;
};

function youtubeVideoId(sourceUrl: string | null): string | null {
	if (!sourceUrl) return null;
	try {
		const url = new URL(sourceUrl);
		const host = url.hostname.replace(/^www\./, '').toLowerCase();

		if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] ?? null;

		if (
			host === 'youtube.com' ||
			host.endsWith('.youtube.com') ||
			host === 'youtube-nocookie.com' ||
			host.endsWith('.youtube-nocookie.com')
		) {
			if (url.pathname === '/watch') return url.searchParams.get('v');
			return url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1] ?? null;
		}
	} catch {
		return null;
	}
	return null;
}

/**
 * The image a compact shelf card should use.
 *
 * `preview_image` is a PostgREST computed field that includes both ordinary
 * source thumbnails and the first non-base64 image embedded in a note. The
 * source-image fallback keeps this helper tolerant of older databases, while
 * YouTube's deterministic thumbnail URL covers shares that were saved before
 * their metadata request finished.
 */
export function previewImageFor(row: PreviewImageRow): string | null {
	const stored = row.preview_image?.trim() || row.source_image?.trim();
	if (stored) return stored;

	const videoId = youtubeVideoId(row.source_url ?? null);
	return videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : null;
}
