import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = ({ data, depends, fetch }) => {
	depends('supabase:auth');

	const supabase = isBrowser()
		? createBrowserClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
				global: { fetch }
			})
		: createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
				global: { fetch },
				cookies: {
					getAll: () => data.cookies
				}
			});

	// `...data` is load-bearing, not tidiness. Within one layer a universal
	// load's return value *replaces* the server load's rather than merging
	// with it, so anything +layout.server.ts provides — recentThreads,
	// recentTags — never reached `page.data` without this. That's why the
	// composer's Continue strip and the share sheet's tag row could look
	// correct in the source and render empty in the app.
	//
	// The server has also already resolved and verified the identity in
	// hooks.server.ts. Asking the browser client for it again here is normally
	// a cookie read, but an expired token turns it into a refresh request — and
	// because a universal layout waits for its return value, that request can
	// hold an installed PWA on the OS splash screen. onAuthStateChange below
	// invalidates this load whenever the browser session actually changes.
	return { ...data, supabase };
};
