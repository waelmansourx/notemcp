/// <reference lib="webworker" />

import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);

self.skipWaiting();
self.addEventListener('activate', () => self.clients.claim());

// Sharing text/links happens as a plain GET navigation to /capture (see
// vite.config.ts), which needs no interception. Sharing an image has to be a
// POST with multipart form data — there's no way to GET binary file bytes —
// and the only place a service worker can read a POST body is right here,
// before it ever reaches the network. We stash the file in Cache Storage
// (IndexedDB would also work, but Cache Storage already deals in
// Request/Response pairs, which is exactly the shape a File is) under a
// one-time id, then redirect to a normal GET the capture page can load.
const SHARE_CACHE = 'notemcp-share-v1';

/* ---------------- opening the app without a network ----------------

   Precaching the build gets the JS and the fonts onto the device, but the app
   still began with a navigation to a server-rendered page — so with no
   connection there was nothing to render it into, and the PWA opened to the
   browser's offline screen. Capture is the one thing this app has to be able
   to do anywhere (a queued note already survives being offline; see
   $lib/outbox), and it couldn't, because you could never get far enough in to
   write one.

   Network-first, not cache-first: the copy here is a fallback for having no
   connection, never a way to save a round trip. Falling back to the cache when
   the network merely *failed* is the whole distinction — a stale page served
   over a working connection would be a bug, not a feature.

   Client-side navigation asks for `<route>/__data.json` rather than a page, so
   both live in the same cache. Without the second, opening the app offline
   worked and then tapping anything inside it didn't. */
const PAGE_CACHE = 'notemcp-pages-v1';

/** Endpoints where a stale answer would be worse than an honest failure: the
 *  JSON API, the MCP shim, and anything to do with signing in. */
const NEVER_CACHE = /^\/(api|mcp|token|auth|register|authorize|login|\.well-known)(\/|$)/;

function isPageRequest(request: Request, url: URL): boolean {
	if (request.method !== 'GET' || url.origin !== self.location.origin) return false;
	if (NEVER_CACHE.test(url.pathname)) return false;
	return request.mode === 'navigate' || url.pathname.endsWith('/__data.json');
}

self.addEventListener('fetch', (event: FetchEvent) => {
	const url = new URL(event.request.url);
	if (event.request.method === 'POST' && url.pathname === '/capture') {
		event.respondWith(handleShareTarget(event.request));
		return;
	}
	if (isPageRequest(event.request, url)) {
		event.respondWith(handlePage(event.request));
	}
});

async function handlePage(request: Request): Promise<Response> {
	const cache = await caches.open(PAGE_CACHE);

	try {
		const response = await fetch(request);

		/* Only a real page is worth keeping. `redirected` catches the auth
		   guard bouncing a signed-out request to /login — storing that under
		   the URL you asked for would mean opening the app offline and being
		   told to sign in, forever. */
		if (response.ok && !response.redirected) {
			// Not awaited: the body is streamed (the stream page sends its
			// shell first and its notes after), so this settles when the
			// server has finished talking, long after the page is on screen.
			cache.put(request, response.clone()).catch(() => {});
		}
		return response;
	} catch {
		const cached = await cache.match(request);
		if (cached) return cached;

		/* Nothing for this exact URL — but the app is a single shell, and any
		   page of it can boot the rest, so the stream is a better answer than
		   the browser's offline screen. Its notes render from localStorage
		   anyway, so what arrives is the app, not a stale snapshot. */
		const shell = await cache.match('/');
		if (shell && request.mode === 'navigate') return shell;

		return new Response('Offline', {
			status: 503,
			statusText: 'Offline',
			headers: { 'content-type': 'text/plain' }
		});
	}
}

async function handleShareTarget(request: Request): Promise<Response> {
	const params = new URLSearchParams();

	try {
		const formData = await request.formData();
		const title = formData.get('title');
		const text = formData.get('text');
		const sharedUrl = formData.get('url');
		if (typeof title === 'string' && title) params.set('title', title);
		if (typeof text === 'string' && text) params.set('text', text);
		if (typeof sharedUrl === 'string' && sharedUrl) params.set('url', sharedUrl);

		const files = formData
			.getAll('images')
			.filter((value): value is File => value instanceof File && value.size > 0);
		if (files.length > 0) {
			const cache = await caches.open(SHARE_CACHE);
			await Promise.all(
				files.map(async (file) => {
					const shareId = crypto.randomUUID();
					await cache.put(
						`/__share/${shareId}`,
						new Response(file, {
							headers: { 'content-type': file.type || 'application/octet-stream' }
						})
					);
					params.append('shared', shareId);
				})
			);
		}
	} catch {
		// Malformed share payload — fall through to a bare /capture with
		// whatever params we managed to collect (possibly none).
	}

	return Response.redirect(`/capture?${params.toString()}`, 303);
}
