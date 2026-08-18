<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { browser } from '$app/environment';
	import { flushOutbox } from '$lib/outbox';
	import Toast from '$lib/components/Toast.svelte';

	let { children, data } = $props();

	if (browser) {
		import('virtual:pwa-register/svelte').then(({ useRegisterSW }) => {
			useRegisterSW({ immediate: true });
		});
	}

	onMount(() => {
		const {
			data: { subscription }
		} = data.supabase.auth.onAuthStateChange((_event, session) => {
			if (session?.expires_at !== data.session?.expires_at) {
				invalidate('supabase:auth');
			}
		});

		// Retry any capture that queued locally but never made it to the
		// server (e.g. offline at share time).
		flushOutbox();

		// CodeMirror is the heaviest chunk in the app and is loaded on demand
		// when a note is opened, which put a visible pause on the first tap of
		// every session. Fetching it once the stream has settled means that tap
		// resolves against a warm cache instead of a cold network request.
		const warm =
			typeof requestIdleCallback === 'function'
				? requestIdleCallback(() => {
						import('$lib/editor/markdown-live');
					})
				: null;

		return () => {
			if (warm !== null) cancelIdleCallback(warm);
			subscription.unsubscribe();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content="#f4efe6" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#17140f" media="(prefers-color-scheme: dark)" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="default" />
	<meta name="apple-mobile-web-app-title" content="NoteMCP" />
	<link rel="apple-touch-icon" href="/icons/icon-192.png" />
</svelte:head>

{@render children()}

<Toast />
