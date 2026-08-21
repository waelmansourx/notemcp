import type { SupabaseClient, Session } from '@supabase/supabase-js';

interface AuthenticatedUser {
	id: string;
	email?: string;
}

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			supabase: SupabaseClient;
			safeGetSession: () => Promise<{
				session: Session | null;
				user: AuthenticatedUser | null;
			}>;
			session: Session | null;
			user: AuthenticatedUser | null;
		}
		interface PageData {
			authExpiresAt: number | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
