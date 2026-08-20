import { describe, expect, test } from 'bun:test';
import {
	GET_NOTE_ASSET_INPUT_SCHEMA,
	NOTE_ASSET_LIMITS,
	NoteAssetError,
	clampAssetSize,
	fetchRemoteAssetImage,
	isForbiddenAssetAddress,
	loadNoteAsset,
	normalizeAssetImage,
	noteAssetDescriptorErrorMessage,
	noteAssetDescriptorRpcArgs,
	noteAssetErrorMessage,
	parseNoteAssetRequest,
	validateDecodedAsset
} from './mcp-assets';
import { imageToolResult } from './mcp-presentation';

const NOTE_ID = '20000000-0000-0000-0000-000000000002';
const PUBLIC_ADDRESS = '93.184.216.34';
const resolvePublic = async () => [PUBLIC_ADDRESS];

function response(body: BodyInit | null, contentType: string, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	if (contentType) headers.set('content-type', contentType);
	return new Response(body, { ...init, headers });
}

describe('MCP asset request', () => {
	test('uses a strict note-id-only fetch surface with bounded optional selectors', () => {
		expect(GET_NOTE_ASSET_INPUT_SCHEMA.additionalProperties).toBe(false);
		expect(GET_NOTE_ASSET_INPUT_SCHEMA.properties).not.toHaveProperty('url');

		const parsed = parseNoteAssetRequest({ id: NOTE_ID });
		expect(parsed).toEqual({ id: NOTE_ID, asset: 'source', index: 0, maxSize: 640 });
		expect(noteAssetDescriptorRpcArgs('token', parsed)).toEqual({
			p_token: 'token',
			p_note_id: NOTE_ID,
			p_asset: 'source',
			p_index: 0
		});
	});

	test('rejects an arbitrary URL instead of forwarding or ignoring it', () => {
		expect(() =>
			parseNoteAssetRequest({ id: NOTE_ID, url: 'https://attacker.example/payload' })
		).toThrow('Unsupported get_note_asset argument: url');
	});

	test('validates selector bounds before the database call', () => {
		expect(() => parseNoteAssetRequest({ id: 'not-a-uuid' })).toThrow('valid note id');
		expect(() => parseNoteAssetRequest({ id: NOTE_ID, index: 21 })).toThrow('between 0 and 20');
		expect(() => parseNoteAssetRequest({ id: NOTE_ID, max_size: 900 })).toThrow(
			'between 512 and 768'
		);
	});
});

describe('MCP asset size', () => {
	test('uses the bounded visual retrieval range', () => {
		expect(clampAssetSize(undefined)).toBe(640);
		expect(clampAssetSize(100)).toBe(512);
		expect(clampAssetSize(700.4)).toBe(700);
		expect(clampAssetSize(4000)).toBe(768);
	});

	test('rejects decoded dimensions over the explicit pixel ceiling', () => {
		expect(() => validateDecodedAsset({ format: 'jpeg', width: 10_000, height: 5_000 })).toThrow(
			new NoteAssetError('decoded_too_large')
		);
		expect(validateDecodedAsset({ format: 'png', width: 4000, height: 3000 })).toEqual({
			format: 'png',
			width: 4000,
			height: 3000
		});
	});
});

describe('MCP asset SSRF address checks', () => {
	test('blocks private, loopback, link-local and reserved IPv4', () => {
		for (const address of [
			'10.0.0.1',
			'127.0.0.1',
			'169.254.169.254',
			'172.16.4.2',
			'192.168.1.4',
			'100.64.0.1',
			'224.0.0.1'
		]) {
			expect(isForbiddenAssetAddress(address)).toBe(true);
		}
		expect(isForbiddenAssetAddress('8.8.8.8')).toBe(false);
	});

	test('blocks private IPv6 and IPv4-mapped loopback', () => {
		for (const address of [
			'::',
			'::1',
			'fc00::1',
			'fe80::1',
			'2001:db8::1',
			'::127.0.0.1',
			'::ffff:127.0.0.1',
			'64:ff9b::10.0.0.1'
		]) {
			expect(isForbiddenAssetAddress(address)).toBe(true);
		}
		expect(isForbiddenAssetAddress('2606:4700:4700::1111')).toBe(false);
	});

	test('rejects a redirect to loopback before making the redirected request', async () => {
		let requests = 0;
		const result = fetchRemoteAssetImage('https://public.example/image.jpg', {
			resolve: resolvePublic,
			request: async () => {
				requests += 1;
				return response(null, '', {
					status: 302,
					headers: { location: 'https://127.0.0.1/admin' }
				});
			}
		});

		await expect(result).rejects.toMatchObject({ code: 'unsafe_url' });
		expect(requests).toBe(1);
	});

	test('passes the validated public address to the request layer for DNS pinning', async () => {
		let pinnedAddress = '';
		const bytes = await fetchRemoteAssetImage('https://images.example/preview.png', {
			resolve: resolvePublic,
			request: async (_url, address) => {
				pinnedAddress = address;
				return response(new Uint8Array([1, 2, 3]), 'image/png');
			}
		});

		expect(pinnedAddress).toBe(PUBLIC_ADDRESS);
		expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
	});
});

describe('remote MCP asset validation', () => {
	test('rejects HTML, JSON and executable responses as unsupported content', async () => {
		for (const contentType of ['text/html', 'application/json', 'application/octet-stream']) {
			const result = fetchRemoteAssetImage('https://images.example/not-an-image', {
				resolve: resolvePublic,
				request: async () => response('<html>not an image</html>', contentType)
			});
			await expect(result).rejects.toMatchObject({ code: 'unsupported_image' });
		}
	});

	test('rejects a declared remote response larger than the download limit', async () => {
		const result = fetchRemoteAssetImage('https://images.example/huge.jpg', {
			resolve: resolvePublic,
			request: async () =>
				response(new Uint8Array([1]), 'image/jpeg', {
					headers: { 'content-length': String(NOTE_ASSET_LIMITS.remoteDownloadBytes + 1) }
				})
		});

		await expect(result).rejects.toMatchObject({ code: 'download_too_large' });
	});

	test('does not trust an image MIME type when the bytes are not an image', async () => {
		await expect(
			normalizeAssetImage(new TextEncoder().encode('<html>still not an image</html>'), 640)
		).rejects.toMatchObject({ code: 'unsupported_image' });
	});
});

describe('MCP asset normalization', () => {
	test('loads a stored source thumbnail and returns native MCP image content', async () => {
		// @ts-expect-error sharp 0.35 omits its declaration export condition
		const { default: sharp } = await import('sharp');
		const original = await sharp({
			create: {
				width: 900,
				height: 450,
				channels: 3,
				background: { r: 180, g: 80, b: 40 }
			}
		})
			.jpeg()
			.toBuffer();

		const loaded = await loadNoteAsset(
			{
				note_id: NOTE_ID,
				asset: 'source',
				index: 0,
				kind: 'remote',
				url: 'https://images.example/preview.jpg',
				cache_key: `${NOTE_ID}/mcp-assets/${NOTE_ID}/source-${'a'.repeat(64)}.webp`
			},
			640,
			{
				network: {
					resolve: resolvePublic,
					request: async () => response(original, 'image/jpeg')
				},
				storage: {
					objectExists: async () => false,
					getObject: async () => response(null, '', { status: 404 }),
					putObject: async () => {}
				}
			}
		);
		const result = imageToolResult(
			{
				note_id: NOTE_ID,
				mime_type: loaded.mimeType,
				width: loaded.width,
				height: loaded.height
			},
			loaded
		);

		expect(loaded.mimeType).toBe('image/webp');
		expect([loaded.width, loaded.height]).toEqual([640, 320]);
		expect(result.content[1]).toEqual({
			type: 'image',
			data: loaded.data,
			mimeType: 'image/webp'
		});
		expect(result.structuredContent).not.toHaveProperty('data');
	});

	test('resizes a large image to the configured maximum while preserving aspect ratio', async () => {
		// @ts-expect-error sharp 0.35 omits its declaration export condition
		const { default: sharp } = await import('sharp');
		const original = await sharp({
			create: {
				width: 1200,
				height: 600,
				channels: 3,
				background: { r: 90, g: 130, b: 170 }
			}
		})
			.jpeg({ quality: 90 })
			.toBuffer();

		const normalized = await normalizeAssetImage(original, 640);
		const metadata = await sharp(normalized.data).metadata();
		expect(metadata.format).toBe('webp');
		expect([normalized.width, normalized.height]).toEqual([640, 320]);
		expect(normalized.data.byteLength).toBeLessThanOrEqual(NOTE_ASSET_LIMITS.finalEncodedBytes);
	});

	test('does not upscale a smaller source preview', async () => {
		// @ts-expect-error sharp 0.35 omits its declaration export condition
		const { default: sharp } = await import('sharp');
		const original = await sharp({
			create: {
				width: 320,
				height: 200,
				channels: 3,
				background: { r: 30, g: 60, b: 90 }
			}
		})
			.png()
			.toBuffer();

		const normalized = await normalizeAssetImage(original, 640);
		expect([normalized.width, normalized.height]).toEqual([320, 200]);
	});
});

describe('MCP asset client errors', () => {
	test('maps missing and inaccessible descriptors without exposing database details', () => {
		expect(noteAssetDescriptorErrorMessage('Source image not found', 'source')).toBe(
			'No source preview is stored for this note.'
		);
		expect(noteAssetDescriptorErrorMessage('Note not found', 'source')).toBe('Note not found.');
		expect(noteAssetDescriptorErrorMessage('relation private.foo failed', 'source')).toBe(
			'The source preview could not be looked up for this note.'
		);
	});

	test('treats expired CDN responses as a normal unavailable-preview condition', () => {
		expect(noteAssetErrorMessage(new NoteAssetError('unavailable'), 'source')).toBe(
			'Source preview is no longer available for this note.'
		);
	});
});
