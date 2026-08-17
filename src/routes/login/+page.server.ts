import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	return {
		redirectTo: url.searchParams.get('redirectTo') ?? '/'
	};
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase }, url }) => {
		const formData = await request.formData();
		const email = String(formData.get('email') ?? '').trim();
		const redirectTo = String(formData.get('redirectTo') ?? '/');

		if (!email) {
			return fail(400, { error: 'Enter your email.' });
		}

		const callback = new URL('/auth/callback', url.origin);
		callback.searchParams.set('redirectTo', redirectTo);

		const { error } = await supabase.auth.signInWithOtp({
			email,
			options: { emailRedirectTo: callback.toString() }
		});

		if (error) {
			return fail(400, { error: error.message });
		}

		return { sent: true, email };
	}
};
