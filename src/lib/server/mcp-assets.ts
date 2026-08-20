import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const REMOTE_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
const CACHE_KEY =
	/^[0-9a-f]{8}-[0-9a-f-]{27}\/mcp-assets\/[0-9a-f]{8}-[0-9a-f-]{27}\/[a-zA-Z0-9.-]+\.webp$/;
const ALLOWED_IMAGE_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/avif',
	'image/heic',
	'image/heif'
]);

export type NoteAssetDescriptor = {
	note_id: string;
	asset: 'source' | 'body';
	index: number;
	kind: 'remote' | 'r2';
	url?: string;
	r2_key?: string;
	mime_type?: string;
	cache_key: string;
};

export type LoadedNoteAsset = {
	data: string;
	mimeType: 'image/webp';
	width: number;
	height: number;
	byteSize: number;
	cached: boolean;
};

function ipv4Parts(address: string): number[] | null {
	const parts = address.split('.').map(Number);
	return parts.length === 4 &&
		parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
		? parts
		: null;
}

function forbiddenIpv4(address: string): boolean {
	const parts = ipv4Parts(address);
	if (!parts) return true;
	const [a, b] = parts;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && (b === 0 || b === 168)) ||
		(a === 198 && (b === 18 || b === 19 || b === 51)) ||
		(a === 203 && b === 0) ||
		a >= 224
	);
}

function ipv6Bytes(address: string): Uint8Array | null {
	const clean = address.toLowerCase().split('%')[0];
	const halves = clean.split('::');
	if (halves.length > 2) return null;

	function groups(part: string): number[] | null {
		if (!part) return [];
		const raw = part.split(':');
		const values: number[] = [];
		for (const group of raw) {
			if (group.includes('.')) {
				const v4 = ipv4Parts(group);
				if (!v4) return null;
				values.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
			} else {
				if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
				values.push(Number.parseInt(group, 16));
			}
		}
		return values;
	}

	const left = groups(halves[0]);
	const right = groups(halves[1] ?? '');
	if (!left || !right) return null;
	const missing = 8 - left.length - right.length;
	if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
	const values = [...left, ...Array(missing).fill(0), ...right];
	if (values.length !== 8) return null;

	const bytes = new Uint8Array(16);
	values.forEach((value, index) => {
		bytes[index * 2] = value >> 8;
		bytes[index * 2 + 1] = value & 0xff;
	});
	return bytes;
}

export function isForbiddenAssetAddress(address: string): boolean {
	const version = isIP(address);
	if (version === 4) return forbiddenIpv4(address);
	if (version !== 6) return true;
	const bytes = ipv6Bytes(address);
	if (!bytes) return true;

	const allZero = bytes.every((value) => value === 0);
	const loopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1;
	const uniqueLocal = (bytes[0] & 0xfe) === 0xfc;
	const linkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;
	const multicast = bytes[0] === 0xff;
	const documentation =
		bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8;
	const mappedV4 =
		bytes.slice(0, 10).every((value) => value === 0) && bytes[10] === 0xff && bytes[11] === 0xff;

	return (
		allZero ||
		loopback ||
		uniqueLocal ||
		linkLocal ||
		multicast ||
		documentation ||
		(mappedV4 && forbiddenIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`))
	);
}

async function assertSafeRemoteUrl(value: string): Promise<URL> {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Stored source image URL is invalid');
	}

	if (url.protocol !== 'https:' || url.username || url.password || url.port) {
		throw new Error('Stored source image URL is not a safe HTTPS URL');
	}
	const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
	if (
		!hostname ||
		hostname === 'localhost' ||
		hostname.endsWith('.localhost') ||
		hostname.endsWith('.local') ||
		hostname.endsWith('.internal') ||
		hostname.endsWith('.home.arpa')
	) {
		throw new Error('Stored source image host is not allowed');
	}

	const addresses = isIP(hostname)
		? [{ address: hostname }]
		: await lookup(hostname, { all: true, verbatim: true });
	if (!addresses.length || addresses.some(({ address }) => isForbiddenAssetAddress(address))) {
		throw new Error('Stored source image resolves to a private or reserved address');
	}
	return url;
}

async function readBounded(response: Response): Promise<Uint8Array> {
	if (!response.ok || !response.body) throw new Error(`Image fetch failed (${response.status})`);
	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
		throw new Error('Image exceeds the download limit');
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_DOWNLOAD_BYTES) {
			await reader.cancel();
			throw new Error('Image exceeds the download limit');
		}
		chunks.push(value);
	}

	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function fetchRemoteImage(value: string): Promise<Uint8Array> {
	let url = await assertSafeRemoteUrl(value);
	for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
		const response = await fetch(url, {
			redirect: 'manual',
			headers: {
				accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
				'user-agent': 'NoteMCP-Asset-Fetch/1.0'
			},
			signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS)
		});

		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location');
			if (!location || redirects === MAX_REDIRECTS) throw new Error('Image redirect was rejected');
			url = await assertSafeRemoteUrl(new URL(location, url).toString());
			continue;
		}

		const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
		if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
			throw new Error('Stored source did not return a supported image');
		}
		return readBounded(response);
	}
	throw new Error('Image redirect limit exceeded');
}

export function clampAssetSize(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return 640;
	return Math.min(Math.max(Math.round(parsed), 512), 768);
}

function sizedCacheKey(cacheKey: string, size: number): string {
	if (!CACHE_KEY.test(cacheKey)) throw new Error('Invalid stored asset cache key');
	return cacheKey.replace(/\.webp$/, `-${size}.webp`);
}

export async function loadNoteAsset(
	descriptor: NoteAssetDescriptor,
	maxSize: number
): Promise<LoadedNoteAsset> {
	// Sharp is a native optional dependency. Loading it at module scope makes a
	// missing Netlify/libvips binary crash the entire MCP route, including tools
	// such as list_tags that never touch images. Keep that failure isolated to
	// get_note_asset while Netlify packages the Linux runtime below.
	// sharp 0.35 ships declarations but omits the `types` export condition.
	// @ts-expect-error upstream package exports do not expose lib/index.d.ts
	const { default: sharp } = await import('sharp');
	// Keep Svelte's private-env R2 module behind the server-only call path. This
	// also leaves the pure URL/IP guards independently unit-testable in Bun.
	const { getObject, objectExists, putObject } = await import('$lib/server/r2');
	const cacheKey = sizedCacheKey(descriptor.cache_key, maxSize);
	if (await objectExists(cacheKey)) {
		const cachedResponse = await getObject(cacheKey);
		const cachedBytes = await readBounded(cachedResponse);
		const metadata = await sharp(cachedBytes).metadata();
		return {
			data: Buffer.from(cachedBytes).toString('base64'),
			mimeType: 'image/webp',
			width: metadata.width ?? maxSize,
			height: metadata.height ?? maxSize,
			byteSize: cachedBytes.byteLength,
			cached: true
		};
	}

	let original: Uint8Array;
	if (descriptor.kind === 'remote' && descriptor.url) {
		original = await fetchRemoteImage(descriptor.url);
	} else if (descriptor.kind === 'r2' && descriptor.r2_key) {
		original = await readBounded(await getObject(descriptor.r2_key));
	} else {
		throw new Error('Stored note asset descriptor is invalid');
	}

	const { data, info } = await sharp(original, {
		limitInputPixels: 40_000_000,
		animated: false,
		failOn: 'warning'
	})
		.rotate()
		.resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
		.webp({ quality: 78, effort: 4 })
		.toBuffer({ resolveWithObject: true });

	let cached = false;
	try {
		await putObject(cacheKey, 'image/webp', data);
		cached = true;
	} catch {
		// A cache failure must not discard an otherwise valid on-demand asset.
	}

	return {
		data: data.toString('base64'),
		mimeType: 'image/webp',
		width: info.width,
		height: info.height,
		byteSize: data.byteLength,
		cached
	};
}
