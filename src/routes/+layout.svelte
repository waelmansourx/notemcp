<script lang="ts">
	import '$lib/assets/fonts.css';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { invalidate, onNavigate } from '$app/navigation';
	import { browser } from '$app/environment';
	import { flushOutbox, flushEdits } from '$lib/outbox';
	import { setSuggestions } from '$lib/cache.svelte';
	import { clearCache } from '$lib/cache';
	import Toast from '$lib/components/Toast.svelte';

	let { children, data } = $props();

	/* The tag row every capture surface offers. The layout streams it rather
	   than blocking navigation on it, so this is where the answer lands when it
	   arrives; the composer and the share sheet read the cache, which means
	   they show the row you had last time and it updates underneath them.

	   Nothing awaits this and nothing renders it directly, so a rejection here
	   would be an unhandled one — the load already catches, and this catches
	   again rather than trusting that from a distance. */
	$effect(() => {
		const incoming = data.recentTags;
		let live = true;
		Promise.resolve(incoming)
			.then((tags) => {
				// null means the query failed — leave the cached row alone.
				if (live && Array.isArray(tags)) setSuggestions(tags);
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	});

	// Opening a note from the stream reads as a link — a jump to a different
	// page — unless something bridges the two frames. A View Transition does
	// that for free: elements sharing a `view-transition-name` (an entry's
	// body, the editor's title+body card — see Entry.svelte / NoteEditor.svelte)
	// cross-fade and morph into each other instead of the page just swapping,
	// so tapping a note reads as that note expanding in place, not as leaving
	// it for somewhere else. Everything without a shared name still gets a
	// plain cross-fade, and browsers without the API just navigate as before.
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	if (browser) {
		import('virtual:pwa-register/svelte').then(({ useRegisterSW }) => {
			useRegisterSW({ immediate: true });
		});
	}

	onMount(() => {
		const {
			data: { subscription }
		} = data.supabase.auth.onAuthStateChange((event, session) => {
			// The stream is cached on this device, not per account. Signing out
			// has to take it with it, or the next person to sign in here opens
			// the app to someone else's notes for as long as the server takes
			// to answer.
			if (event === 'SIGNED_OUT') {
				clearCache();
				setSuggestions([]);
			}

			if (session?.expires_at !== data.session?.expires_at) {
				invalidate('supabase:auth');
			}
		});

		// Retry any capture that queued locally but never made it to the
		// server (e.g. offline at share time) — then any edit that didn't
		// either. Creates first, so a thought still queued as a create is a
		// real note by the time anything tries to patch it.
		flushOutbox().then(flushEdits);

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
