<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { browser } from '$app/environment';
	import { flushOutbox } from '$lib/outbox';

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

		return () => subscription.unsubscribe();
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
