import tailwindcss from '@tailwindcss/vite';
import adapterNetlify from '@sveltejs/adapter-netlify';
import adapterNode from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

const adapter =
	process.env.NETLIFY === 'true' || process.env.ADAPTER === 'netlify'
		? adapterNetlify()
		: adapterNode();

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter,
			csrf: {
				// /token (OAuth code exchange) has to accept cross-origin
				// application/x-www-form-urlencoded POSTs from whatever server
				// claude.ai calls it from — per the OAuth spec that's the
				// required content-type for token requests, and a
				// server-to-server call typically carries no Origin header at
				// all, so no trustedOrigins allowlist can admit it; only
				// turning the check off entirely does. This is safe here: /token
				// is stateless (auth is the code+verifier in the body, not a
				// cookie) so CSRF doesn't apply to it, and the one route that
				// actually acts on a cookie-authenticated session for another
				// party's benefit (/authorize's approve action) is still
				// protected by the session cookie's SameSite=Lax attribute,
				// which this setting doesn't affect.
				checkOrigin: false
			}
		}),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			injectRegister: false,
			devOptions: { enabled: false },
			strategies: 'injectManifest',
			srcDir: 'src',
			filename: 'service-worker.ts',
			manifest: {
				name: 'NoteMCP',
				short_name: 'NoteMCP',
				description: 'Capture without deciding.',
				start_url: '/',
				scope: '/',
				display: 'standalone',
				// Matches layout.css's light --color-bg exactly. The manifest can
				// only declare one background_color (no dark-mode media query),
				// and the OS draws it full-screen before any app CSS runs — a
				// mismatch here is what made the splash-to-app transition look
				// like a slow, jarring flash rather than a fast handoff.
				background_color: '#f4efe6',
				theme_color: '#f4efe6',
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
					{
						src: '/icons/icon-maskable-192.png',
						sizes: '192x192',
						type: 'image/png',
						purpose: 'maskable'
					},
					{
						src: '/icons/icon-maskable-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				],
				// A share_target can only declare one method, and file shares
				// require POST + multipart, so every share (text, link, or
				// image) now goes through here. The service worker intercepts
				// the POST (see src/service-worker.ts), stashes any file in
				// Cache Storage, and redirects to a plain GET /capture.
				share_target: {
					action: '/capture',
					method: 'POST',
					enctype: 'multipart/form-data',
					params: {
						title: 'title',
						text: 'text',
						url: 'url',
						files: [{ name: 'images', accept: ['image/*'] }]
					}
				},
				// Without this, Android treats a share (or any launch) as "open a
				// new document" — a brand new Activity with its own cold start,
				// hence its own OS splash screen, even with the app already open
				// in another task. `navigate-existing` tells it to bring that
				// window forward and navigate it instead, which is what makes
				// sharing into an already-open app feel instant rather than a
				// second app launch.
				launch_handler: {
					client_mode: 'navigate-existing'
				}
			} as any,
			injectManifest: {
				// woff2 added for the self-hosted Newsreader/Inter files
				// (static/fonts) — precached like everything else, so notes keep
				// their fonts offline instead of falling back to system ones.
				globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest,woff2}']
			}
		})
	]
});
