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

self.addEventListener('fetch', (event: FetchEvent) => {
	const url = new URL(event.request.url);
	if (event.request.method === 'POST' && url.pathname === '/capture') {
		event.respondWith(handleShareTarget(event.request));
	}
});

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

		const file = formData.get('images');
		if (file instanceof File && file.size > 0) {
			const cache = await caches.open(SHARE_CACHE);
			const shareId = crypto.randomUUID();
			await cache.put(
				`/__share/${shareId}`,
				new Response(file, { headers: { 'content-type': file.type || 'application/octet-stream' } })
			);
			params.set('shared', shareId);
		}
	} catch {
		// Malformed share payload — fall through to a bare /capture with
		// whatever params we managed to collect (possibly none).
	}

	return Response.redirect(`/capture?${params.toString()}`, 303);
}
