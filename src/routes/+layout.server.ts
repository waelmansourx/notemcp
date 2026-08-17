import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { session }, cookies }) => {
	// authGuard (hooks.server.ts) already ran safeGetSession() for this
	// request — reuse its result instead of re-verifying with Supabase again,
	// which was adding a second network round-trip to every page load.
	return {
		session,
		cookies: cookies.getAll()
	};
};
