import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

export const NOTE_ASSET_LIMITS = {
	defaultDimension: 640,
	minDimension: 512,
	maxDimension: 768,
	remoteDownloadBytes: 10 * 1024 * 1024,
	r2DownloadBytes: 15 * 1024 * 1024,
	decodedPixels: 40_000_000,
	finalEncodedBytes: 1024 * 1024,
	redirects: 3,
	remoteTimeoutMs: 12_000
} as const;

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CACHE_KEY = new RegExp(`^${UUID_PATTERN}/mcp-assets/${UUID_PATTERN}/[a-zA-Z0-9.-]+\\.webp$`);
const ALLOWED_REMOTE_IMAGE_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/avif',
	'image/heic',
	'image/heif'
]);
const ALLOWED_DECODED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif']);
const UUID = new RegExp(`^${UUID_PATTERN}$`, 'i');

export const GET_NOTE_ASSET_INPUT_SCHEMA = {
	type: 'object',
	properties: {
		id: { type: 'string', format: 'uuid', description: 'Note id (uuid)' },
		asset: {
			type: 'string',
			enum: ['source', 'body'],
			description: 'Default source. Body selects an existing uploaded image referenced by the note.'
		},
		index: {
			type: 'integer',
			minimum: 0,
			maximum: 20,
			description: 'Zero-based image index. Default 0.'
		},
		max_size: {
			type: 'integer',
			minimum: NOTE_ASSET_LIMITS.minDimension,
			maximum: NOTE_ASSET_LIMITS.maxDimension,
			description: 'Maximum width/height in pixels. Default 640.'
		}
	},
	required: ['id'],
	additionalProperties: false
} as const;

export const NOTE_ASSET_OUTPUT_SCHEMA = {
	type: 'object',
	properties: {
		note_id: { type: 'string', format: 'uuid' },
		asset: { type: 'string', enum: ['source', 'body'] },
		index: { type: 'integer' },
		mime_type: { type: 'string', enum: ['image/webp'] },
		width: { type: 'integer' },
		height: { type: 'integer' },
		byte_size: { type: 'integer' },
		cached: { type: 'boolean' }
	},
	required: ['note_id', 'asset', 'index', 'mime_type', 'width', 'height', 'byte_size', 'cached'],
	additionalProperties: false
} as const;

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

export type NoteAssetRequest = {
	id: string;
	asset: 'source' | 'body';
	index: number;
	maxSize: number;
};

export type LoadedNoteAsset = {
	data: string;
	mimeType: 'image/webp';
	width: number;
	height: number;
	byteSize: number;
	cached: boolean;
};

export type NoteAssetErrorCode =
	| 'unsafe_url'
	| 'unavailable'
	| 'unsupported_image'
	| 'download_too_large'
	| 'decoded_too_large'
	| 'encoded_too_large'
	| 'invalid_descriptor';

export class NoteAssetError extends Error {
	constructor(readonly code: NoteAssetErrorCode) {
		super(code);
		this.name = 'NoteAssetError';
	}
}

export type AssetFetchDependencies = {
	resolve?: (hostname: string) => Promise<string[]>;
	request?: (url: URL, resolvedAddress: string) => Promise<Response>;
};

export type AssetStorageDependencies = {
	getObject: (key: string) => Promise<Response>;
	objectExists: (key: string) => Promise<boolean>;
	putObject: (key: string, contentType: string, body: Uint8Array) => Promise<void>;
};

export type LoadNoteAssetDependencies = {
	network?: AssetFetchDependencies;
	storage?: AssetStorageDependencies;
};

type DecodedImageMetadata = {
	format?: string;
	width?: number;
	height?: number;
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
		(a === 192 && (b === 0 || b === 88 || b === 168)) ||
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
	const compatibleV4 = bytes.slice(0, 12).every((value) => value === 0);
	const nat64V4 = bytes
		.slice(0, 10)
		.every(
			(value, index) => value === (index === 1 ? 0x64 : index === 2 ? 0xff : index === 3 ? 0x9b : 0)
		);
	const embeddedV4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;

	return (
		allZero ||
		loopback ||
		uniqueLocal ||
		linkLocal ||
		multicast ||
		documentation ||
		((mappedV4 || compatibleV4 || nat64V4) && forbiddenIpv4(embeddedV4))
	);
}

async function defaultResolve(hostname: string): Promise<string[]> {
	const addresses = await lookup(hostname, { all: true, verbatim: true });
	return addresses.map(({ address }) => address);
}

async function safeRemoteTarget(
	value: string,
	resolve: (hostname: string) => Promise<string[]>
): Promise<{ url: URL; address: string }> {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new NoteAssetError('unsafe_url');
	}

	if (url.protocol !== 'https:' || url.username || url.password || url.port) {
		throw new NoteAssetError('unsafe_url');
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
		throw new NoteAssetError('unsafe_url');
	}

	let addresses: string[];
	try {
		addresses = isIP(hostname) ? [hostname] : await resolve(hostname);
	} catch {
		throw new NoteAssetError('unavailable');
	}
	if (!addresses.length || addresses.some(isForbiddenAssetAddress)) {
		throw new NoteAssetError('unsafe_url');
	}

	// Prefer IPv4 when both families are present because some serverless
	// runtimes advertise IPv6 without having a usable IPv6 egress route.
	const address = addresses.find((candidate) => isIP(candidate) === 4) ?? addresses[0];
	return { url, address };
}

function pinnedHttpsRequest(url: URL, resolvedAddress: string): Promise<Response> {
	return new Promise((resolve, reject) => {
		const family = isIP(resolvedAddress);
		const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
			callback(null, resolvedAddress, family);
		};
		let settled = false;
		const request = httpsRequest(
			url,
			{
				method: 'GET',
				lookup: pinnedLookup,
				headers: {
					accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
					'user-agent': 'NoteMCP-Asset-Fetch/1.0'
				}
			},
			(response) => {
				const timer = setTimeout(() => {
					response.destroy(new NoteAssetError('unavailable'));
				}, NOTE_ASSET_LIMITS.remoteTimeoutMs);
				const clearTimer = () => clearTimeout(timer);
				response.once('end', clearTimer);
				response.once('close', clearTimer);

				const headers = new Headers();
				for (const [name, value] of Object.entries(response.headers)) {
					if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
					else if (value !== undefined) headers.set(name, value);
				}

				settled = true;
				const status = response.statusCode ?? 502;
				const body = [204, 205, 304].includes(status)
					? null
					: (Readable.toWeb(response) as unknown as ReadableStream);
				resolve(
					new Response(body, {
						status,
						statusText: response.statusMessage,
						headers
					})
				);
			}
		);

		const timer = setTimeout(() => {
			request.destroy(new NoteAssetError('unavailable'));
		}, NOTE_ASSET_LIMITS.remoteTimeoutMs);
		request.once('response', () => clearTimeout(timer));
		request.once('error', (error) => {
			clearTimeout(timer);
			if (!settled) reject(error);
		});
		request.end();
	});
}

async function cancelResponse(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// The response is being discarded anyway.
	}
}

async function readBounded(
	response: Response,
	maxBytes: number,
	tooLargeCode: Extract<NoteAssetErrorCode, 'download_too_large' | 'encoded_too_large'>
): Promise<Uint8Array> {
	if (!response.ok || !response.body) throw new NoteAssetError('unavailable');
	const contentLength = response.headers.get('content-length');
	const declared = contentLength === null ? Number.NaN : Number(contentLength);
	if (Number.isFinite(declared) && declared > maxBytes) {
		await cancelResponse(response);
		throw new NoteAssetError(tooLargeCode);
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) {
				await reader.cancel();
				throw new NoteAssetError(tooLargeCode);
			}
			chunks.push(value);
		}
	} catch (error) {
		if (error instanceof NoteAssetError) throw error;
		throw new NoteAssetError('unavailable');
	}

	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export async function fetchRemoteAssetImage(
	value: string,
	dependencies: AssetFetchDependencies = {}
): Promise<Uint8Array> {
	const resolve = dependencies.resolve ?? defaultResolve;
	const request = dependencies.request ?? pinnedHttpsRequest;

	try {
		let target = await safeRemoteTarget(value, resolve);
		for (let redirects = 0; redirects <= NOTE_ASSET_LIMITS.redirects; redirects++) {
			const response = await request(target.url, target.address);

			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get('location');
				await cancelResponse(response);
				if (!location || redirects === NOTE_ASSET_LIMITS.redirects) {
					throw new NoteAssetError('unavailable');
				}
				target = await safeRemoteTarget(new URL(location, target.url).toString(), resolve);
				continue;
			}

			if (!response.ok) {
				await cancelResponse(response);
				throw new NoteAssetError('unavailable');
			}
			const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
			if (!contentType || !ALLOWED_REMOTE_IMAGE_TYPES.has(contentType)) {
				await cancelResponse(response);
				throw new NoteAssetError('unsupported_image');
			}
			return readBounded(response, NOTE_ASSET_LIMITS.remoteDownloadBytes, 'download_too_large');
		}
		throw new NoteAssetError('unavailable');
	} catch (error) {
		if (error instanceof NoteAssetError) throw error;
		throw new NoteAssetError('unavailable');
	}
}

export function clampAssetSize(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return NOTE_ASSET_LIMITS.defaultDimension;
	return Math.min(
		Math.max(Math.round(parsed), NOTE_ASSET_LIMITS.minDimension),
		NOTE_ASSET_LIMITS.maxDimension
	);
}

export function parseNoteAssetRequest(args: Record<string, unknown>): NoteAssetRequest {
	const allowed = new Set(['id', 'asset', 'index', 'max_size']);
	const unsupported = Object.keys(args).find((key) => !allowed.has(key));
	if (unsupported) throw new Error(`Unsupported get_note_asset argument: ${unsupported}`);
	if (typeof args.id !== 'string' || !UUID.test(args.id)) {
		throw new Error('get_note_asset requires a valid note id');
	}
	if (args.asset !== undefined && args.asset !== 'source' && args.asset !== 'body') {
		throw new Error('asset must be source or body');
	}
	if (
		args.index !== undefined &&
		(typeof args.index !== 'number' ||
			!Number.isInteger(args.index) ||
			args.index < 0 ||
			args.index > 20)
	) {
		throw new Error('index must be an integer between 0 and 20');
	}
	if (
		args.max_size !== undefined &&
		(typeof args.max_size !== 'number' ||
			!Number.isInteger(args.max_size) ||
			args.max_size < NOTE_ASSET_LIMITS.minDimension ||
			args.max_size > NOTE_ASSET_LIMITS.maxDimension)
	) {
		throw new Error(
			`max_size must be an integer between ${NOTE_ASSET_LIMITS.minDimension} and ${NOTE_ASSET_LIMITS.maxDimension}`
		);
	}

	return {
		id: args.id,
		asset: args.asset === 'body' ? 'body' : 'source',
		index: (args.index as number | undefined) ?? 0,
		maxSize: (args.max_size as number | undefined) ?? NOTE_ASSET_LIMITS.defaultDimension
	};
}

export function noteAssetDescriptorRpcArgs(
	token: string,
	request: NoteAssetRequest
): Record<string, unknown> {
	return {
		p_token: token,
		p_note_id: request.id,
		p_asset: request.asset,
		p_index: request.index
	};
}

export function noteAssetDescriptorErrorMessage(message: string, asset: 'source' | 'body'): string {
	if (message.includes('Note not found')) return 'Note not found.';
	if (message.includes('Source image not found'))
		return 'No source preview is stored for this note.';
	if (message.includes('Body image not found'))
		return 'No matching body image is stored for this note.';
	if (message.includes('invalid_token')) return 'The bearer token is invalid or expired.';
	return asset === 'source'
		? 'The source preview could not be looked up for this note.'
		: 'The note image could not be looked up.';
}

export function noteAssetErrorMessage(error: unknown, asset: 'source' | 'body'): string {
	const label = asset === 'source' ? 'Source preview' : 'Note image';
	if (!(error instanceof NoteAssetError)) return `${label} could not be loaded.`;

	switch (error.code) {
		case 'unsafe_url':
			return 'The stored source preview URL was rejected by network safety checks.';
		case 'unavailable':
			return `${label} is no longer available for this note.`;
		case 'unsupported_image':
			return `${label} is not a supported image.`;
		case 'download_too_large':
			return `${label} exceeds the ${(asset === 'source' ? NOTE_ASSET_LIMITS.remoteDownloadBytes : NOTE_ASSET_LIMITS.r2DownloadBytes) / 1024 / 1024} MiB download limit.`;
		case 'decoded_too_large':
			return `${label} exceeds the ${NOTE_ASSET_LIMITS.decodedPixels / 1_000_000} megapixel decode limit.`;
		case 'encoded_too_large':
			return `${label} could not be reduced below the ${NOTE_ASSET_LIMITS.finalEncodedBytes / 1024 / 1024} MiB response limit.`;
		case 'invalid_descriptor':
			return `${label} could not be loaded.`;
	}
}

function sizedCacheKey(cacheKey: string, size: number): string {
	if (!CACHE_KEY.test(cacheKey)) throw new NoteAssetError('invalid_descriptor');
	return cacheKey.replace(/\.webp$/, `-${size}.webp`);
}

export function validateDecodedAsset(metadata: DecodedImageMetadata): {
	format: string;
	width: number;
	height: number;
} {
	const { format, width, height } = metadata;
	if (!format || !ALLOWED_DECODED_FORMATS.has(format) || !width || !height) {
		throw new NoteAssetError('unsupported_image');
	}
	if (width * height > NOTE_ASSET_LIMITS.decodedPixels) {
		throw new NoteAssetError('decoded_too_large');
	}
	return { format, width, height };
}

export async function normalizeAssetImage(
	original: Uint8Array,
	maxSize: number
): Promise<{ data: Buffer; width: number; height: number }> {
	// Sharp is a native optional dependency. Loading it at module scope makes a
	// missing Netlify/libvips binary crash the entire MCP route, including tools
	// that never touch images. Keep that failure isolated to get_note_asset.
	// sharp 0.35 ships declarations but omits the `types` export condition.
	// @ts-expect-error upstream package exports do not expose lib/index.d.ts
	const { default: sharp } = await import('sharp');

	try {
		const metadata = await sharp(original, {
			limitInputPixels: NOTE_ASSET_LIMITS.decodedPixels,
			animated: false,
			failOn: 'warning'
		}).metadata();
		validateDecodedAsset(metadata);
	} catch (error) {
		if (error instanceof NoteAssetError) throw error;
		const message = error instanceof Error ? error.message.toLowerCase() : '';
		if (message.includes('pixel limit') || message.includes('image exceeds')) {
			throw new NoteAssetError('decoded_too_large');
		}
		throw new NoteAssetError('unsupported_image');
	}

	async function encode(quality: number) {
		return sharp(original, {
			limitInputPixels: NOTE_ASSET_LIMITS.decodedPixels,
			animated: false,
			failOn: 'warning'
		})
			.rotate()
			.resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
			.webp({ quality, effort: 4 })
			.toBuffer({ resolveWithObject: true });
	}

	let encoded = await encode(78);
	if (encoded.data.byteLength > NOTE_ASSET_LIMITS.finalEncodedBytes) encoded = await encode(60);
	if (encoded.data.byteLength > NOTE_ASSET_LIMITS.finalEncodedBytes) {
		throw new NoteAssetError('encoded_too_large');
	}
	return { data: encoded.data, width: encoded.info.width, height: encoded.info.height };
}

export async function loadNoteAsset(
	descriptor: NoteAssetDescriptor,
	maxSize: number,
	dependencies: LoadNoteAssetDependencies = {}
): Promise<LoadedNoteAsset> {
	// Keep Svelte's private-env R2 module behind the server-only call path. This
	// leaves the network guards and normalizer independently unit-testable.
	const { getObject, objectExists, putObject } =
		dependencies.storage ?? (await import('$lib/server/r2'));
	const cacheKey = sizedCacheKey(descriptor.cache_key, maxSize);

	// R2 is an optimization for source previews. A cache outage or corrupt
	// derivative must fall back to the note's original asset.
	try {
		if (await objectExists(cacheKey)) {
			const cachedBytes = await readBounded(
				await getObject(cacheKey),
				NOTE_ASSET_LIMITS.finalEncodedBytes,
				'encoded_too_large'
			);
			// @ts-expect-error upstream package exports do not expose lib/index.d.ts
			const { default: sharp } = await import('sharp');
			const metadata = validateDecodedAsset(
				await sharp(cachedBytes, {
					limitInputPixels: NOTE_ASSET_LIMITS.decodedPixels,
					animated: false,
					failOn: 'warning'
				}).metadata()
			);
			if (metadata.format !== 'webp' || metadata.width > maxSize || metadata.height > maxSize) {
				throw new NoteAssetError('invalid_descriptor');
			}
			return {
				data: Buffer.from(cachedBytes).toString('base64'),
				mimeType: 'image/webp',
				width: metadata.width,
				height: metadata.height,
				byteSize: cachedBytes.byteLength,
				cached: true
			};
		}
	} catch {
		// Continue to the original below and refresh the derivative if possible.
	}

	let original: Uint8Array;
	if (descriptor.kind === 'remote' && descriptor.url) {
		original = await fetchRemoteAssetImage(descriptor.url, dependencies.network);
	} else if (descriptor.kind === 'r2' && descriptor.r2_key) {
		original = await readBounded(
			await getObject(descriptor.r2_key),
			NOTE_ASSET_LIMITS.r2DownloadBytes,
			'download_too_large'
		);
	} else {
		throw new NoteAssetError('invalid_descriptor');
	}

	const normalized = await normalizeAssetImage(original, maxSize);
	let cached = false;
	try {
		await putObject(cacheKey, 'image/webp', normalized.data);
		cached = true;
	} catch {
		// A cache failure must not discard an otherwise valid on-demand asset.
	}

	return {
		data: normalized.data.toString('base64'),
		mimeType: 'image/webp',
		width: normalized.width,
		height: normalized.height,
		byteSize: normalized.data.byteLength,
		cached
	};
}
