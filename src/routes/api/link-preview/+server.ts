import { error, json } from '@sveltejs/kit';
import { lookup } from 'node:dns/promises';
import type { RequestHandler } from './$types';

// Best-effort OpenGraph/title scrape for the capture screen's link preview.
// Always resolves (never throws to the client) — a failed fetch just means
// we fall back to whatever the share intent already gave us.

function isPrivateAddress(ip: string): boolean {
	if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return true;
	if (/^10\./.test(ip)) return true;
	if (/^192\.168\./.test(ip)) return true;
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
	if (/^169\.254\./.test(ip)) return true; // link-local, incl. cloud metadata endpoints
	if (/^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true;
	return false;
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	hellip: '…',
	mdash: '—',
	ndash: '–',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”'
};

function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, ent: string) => {
		if (ent[0] === '#') {
			const code =
				ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : match;
		}
		return NAMED_ENTITIES[ent] ?? match;
	});
}

function extractMeta(html: string, attr: 'property' | 'name', key: string): string | null {
	const re = new RegExp(
		`<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${key}["']`,
		'i'
	);
	const m = html.match(re);
	const val = m?.[1] ?? m?.[2];
	return val ? decodeEntities(val.trim()) : null;
}

const EMPTY = { title: null, description: null, image: null };

function isTikTokHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return host === 'tiktok.com' || host.endsWith('.tiktok.com');
}

async function fetchTikTokPreview(target: string, signal: AbortSignal) {
	try {
		const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(target)}`;
		const res = await fetch(endpoint, {
			signal,
			headers: {
				'user-agent': 'Mozilla/5.0 (compatible; NoteMCPBot/1.0)',
				accept: 'application/json'
			}
		});
		if (!res.ok) return null;

		const data = (await res.json()) as {
			title?: string;
			author_name?: string;
			thumbnail_url?: string;
		};
		const title = data.title?.trim() || null;
		const author = data.author_name?.trim() || null;
		const image = data.thumbnail_url?.trim() || null;
		if (!title && !image) return null;

		return {
			title,
			description: author ? `TikTok by ${author}` : null,
			image
		};
	} catch {
		return null;
	}
}

export const GET: RequestHandler = async ({ url }) => {
	const target = url.searchParams.get('url');
	if (!target) throw error(400, 'Missing url');

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		throw error(400, 'Invalid url');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw error(400, 'Unsupported protocol');
	}

	try {
		const { address } = await lookup(parsed.hostname);
		if (isPrivateAddress(address)) return json(EMPTY);
	} catch {
		return json(EMPTY);
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 4500);

	try {
		if (isTikTokHost(parsed.hostname)) {
			const tiktok = await fetchTikTokPreview(parsed.toString(), controller.signal);
			if (tiktok) return json(tiktok);
		}

		const res = await fetch(parsed.toString(), {
			signal: controller.signal,
			headers: {
				'user-agent': 'Mozilla/5.0 (compatible; NoteMCPBot/1.0)',
				accept: 'text/html'
			}
		});

		if (!res.ok || !res.body) return json(EMPTY);

		const contentType = res.headers.get('content-type') ?? '';
		if (!contentType.includes('text/html')) return json(EMPTY);

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let html = '';
		let received = 0;
		const MAX_BYTES = 200_000;

		while (received < MAX_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			html += decoder.decode(value, { stream: true });
			if (/<\/head>/i.test(html)) break;
		}
		reader.cancel().catch(() => {});

		const ogTitle = extractMeta(html, 'property', 'og:title');
		const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
		const description =
			extractMeta(html, 'property', 'og:description') ?? extractMeta(html, 'name', 'description');
		const image = extractMeta(html, 'property', 'og:image');

		return json({
			title: ogTitle || (titleTag ? decodeEntities(titleTag) : null),
			description,
			image: image ? new URL(image, parsed).toString() : null
		});
	} catch {
		return json(EMPTY);
	} finally {
		clearTimeout(timeout);
	}
};
