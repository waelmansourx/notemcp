<script lang="ts">
	import '$lib/assets/fonts.css';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate, invalidate, onNavigate } from '$app/navigation';
	import { browser, dev } from '$app/environment';
	import { flushOutbox, flushEdits } from '$lib/outbox';
	import { setSuggestions } from '$lib/cache.svelte';
	import { clearCache } from '$lib/cache';
	import Toast from '$lib/components/Toast.svelte';

	let { children, data } = $props();

	let navigationActive = $state(false);
	let navigationProgress = $state(0);
	let navigationSlow = $state(false);
	let progressTimer: ReturnType<typeof setInterval> | undefined;
	let slowTimer: ReturnType<typeof setTimeout> | undefined;
	let finishTimer: ReturnType<typeof setTimeout> | undefined;

	function clearNavigationTimers() {
		if (progressTimer !== undefined) clearInterval(progressTimer);
		if (slowTimer !== undefined) clearTimeout(slowTimer);
		if (finishTimer !== undefined) clearTimeout(finishTimer);
		progressTimer = undefined;
		slowTimer = undefined;
		finishTimer = undefined;
	}

	function beginNavigationFeedback() {
		clearNavigationTimers();
		navigationActive = true;
		navigationSlow = false;
		navigationProgress = 8;

		// Move quickly at first, then asymptotically approach 90%. This makes
		// every navigation acknowledge the tap immediately without pretending
		// we know the real network percentage.
		progressTimer = setInterval(() => {
			const remaining = 90 - navigationProgress;
			navigationProgress = Math.min(90, navigationProgress + Math.max(1.2, remaining * 0.12));
		}, 140);

		// Fast navigations only ever show the top rail. A larger interruption
		// is reserved for waits long enough that the user might otherwise think
		// the tap was missed.
		slowTimer = setTimeout(() => {
			navigationSlow = true;
		}, 850);
	}

	function finishNavigationFeedback() {
		if (!navigationActive) return;
		if (progressTimer !== undefined) clearInterval(progressTimer);
		if (slowTimer !== undefined) clearTimeout(slowTimer);
		progressTimer = undefined;
		slowTimer = undefined;

		navigationSlow = false;
		navigationProgress = 100;
		finishTimer = setTimeout(() => {
			navigationActive = false;
			navigationProgress = 0;
			finishTimer = undefined;
		}, 180);
	}

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

	// Start the rail at the earliest client-navigation hook, before route data
	// and code have finished resolving. Full-page/external navigations keep the
	// browser's own loading affordance instead.
	beforeNavigate((navigation) => {
		if (navigation.willUnload || !navigation.to?.route.id) return;
		beginNavigationFeedback();
	});

	// The layout itself is preserved between routes, so this fires after the
	// destination DOM has landed without unmounting the composer or shell.
	afterNavigate(() => {
		finishNavigationFeedback();
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

	// The production worker is generated during the build. Registering that
	// virtual entry in Vite's dev server only produces a broken worker and an
	// unhandled console rejection; HMR already owns local updates.
	if (browser && !dev) {
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

			if (session?.expires_at !== data.authExpiresAt) {
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
			clearNavigationTimers();
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

{#if navigationActive}
	<div
		class="navigation-progress"
		role="progressbar"
		aria-label="Loading page"
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={Math.round(navigationProgress)}
	>
		<div
			class="navigation-progress__bar"
			style={`transform: scaleX(${navigationProgress / 100})`}
		></div>
	</div>
{/if}

{#if navigationSlow}
	<div class="navigation-interstitial" role="status" aria-live="polite" aria-busy="true">
		<div class="navigation-interstitial__content">
			<span class="navigation-interstitial__spinner" aria-hidden="true"></span>
			<span>Loading</span>
		</div>
	</div>
{/if}

{@render children()}

<Toast />
