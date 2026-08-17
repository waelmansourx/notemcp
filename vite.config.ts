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
				background_color: '#faf9f7',
				theme_color: '#faf9f7',
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
				}
			} as any,
			injectManifest: {
				globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}']
			}
		})
	]
});
