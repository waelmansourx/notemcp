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
			adapter
		}),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			injectRegister: false,
			devOptions: { enabled: false },
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
				share_target: {
					action: '/capture',
					method: 'GET',
					params: {
						title: 'title',
						text: 'text',
						url: 'url'
					}
				}
			} as any,
			workbox: {
				navigateFallback: null,
				globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}']
			}
		})
	]
});
