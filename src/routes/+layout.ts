import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ data, depends, fetch }) => {
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

	const {
		data: { session }
	} = await supabase.auth.getSession();

	// `...data` is load-bearing, not tidiness. Within one layer a universal
	// load's return value *replaces* the server load's rather than merging
	// with it, so anything +layout.server.ts provides — recentThreads,
	// recentTags — never reached `page.data` without this. That's why the
	// composer's Continue strip and the share sheet's tag row could look
	// correct in the source and render empty in the app.
	return { ...data, supabase, session };
};
