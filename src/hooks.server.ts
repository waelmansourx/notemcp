import { createServerClient } from '@supabase/ssr';
import { type Handle, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

const PUBLIC_PATHS = ['/login', '/auth', '/mcp', '/register', '/token', '/.well-known'];

const supabase: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet) => {
				cookiesToSet.forEach(({ name, value, options }) => {
					event.cookies.set(name, value, { ...options, path: '/' });
				});
			}
		}
	});

	event.locals.safeGetSession = async () => {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();
		if (!session) return { session: null, user: null };

		// getClaims() verifies the JWT's signature locally (JWKS is fetched
		// once and cached) instead of round-tripping to the Supabase auth
		// server like getUser() does. Same security guarantee — the token is
		// still cryptographically verified, not just decoded — but it cuts a
		// network call out of every SSR request, which was the main thing
		// standing between a cold PWA launch and first paint.
		const { data, error } = await event.locals.supabase.auth.getClaims();
		if (error || !data) return { session: null, user: null };

		const claims = data.claims;
		const user = {
			...session.user,
			id: claims.sub!,
			email: claims.email ?? session.user.email,
			role: claims.role ?? session.user.role
		};

		return { session, user };
	};

	return resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};

const authGuard: Handle = async ({ event, resolve }) => {
	const { session, user } = await event.locals.safeGetSession();
	event.locals.session = session;
	event.locals.user = user;

	const isPublic = PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p));

	if (!session && !isPublic) {
		const redirectTo = event.url.pathname + event.url.search;
		throw redirect(303, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
	}

	if (session && event.url.pathname === '/login') {
		throw redirect(303, '/');
	}

	return resolve(event);
};

export const handle: Handle = sequence(supabase, authGuard);
