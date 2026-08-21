import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { env } from '$env/dynamic/private';

let cached: SupabaseClient | null = null;

/** Server-only client used by authenticated provider callbacks, which have no user cookie. */
export function supabaseAdmin(): SupabaseClient {
	const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? '';
	if (!key) throw new Error('SUPABASE_SECRET_KEY is required for asynchronous transcription');

	cached ??= createClient(PUBLIC_SUPABASE_URL, key, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	return cached;
}
