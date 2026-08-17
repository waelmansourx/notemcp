import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	return {
		redirectTo: url.searchParams.get('redirectTo') ?? '/'
	};
};

export const actions: Actions = {
	magic: async ({ request, locals: { supabase }, url }) => {
		const formData = await request.formData();
		const email = String(formData.get('email') ?? '').trim();
		const redirectTo = String(formData.get('redirectTo') ?? '/');

		if (!email) {
			return fail(400, { error: 'Enter your email.', mode: 'magic' });
		}

		const callback = new URL('/auth/callback', url.origin);
		callback.searchParams.set('redirectTo', redirectTo);

		const { error } = await supabase.auth.signInWithOtp({
			email,
			options: { emailRedirectTo: callback.toString() }
		});

		if (error) {
			return fail(400, { error: error.message, mode: 'magic' });
		}

		return { sent: true, email, mode: 'magic' };
	},

	password: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const email = String(formData.get('email') ?? '').trim();
		const password = String(formData.get('password') ?? '');
		const redirectTo = String(formData.get('redirectTo') ?? '/');

		if (!email || !password) {
			return fail(400, { error: 'Enter your email and password.', mode: 'password' });
		}

		const { error } = await supabase.auth.signInWithPassword({ email, password });

		if (error) {
			return fail(400, { error: error.message, mode: 'password' });
		}

		throw redirect(303, redirectTo);
	},

	signup: async ({ request, locals: { supabase }, url }) => {
		const formData = await request.formData();
		const email = String(formData.get('email') ?? '').trim();
		const password = String(formData.get('password') ?? '');
		const redirectTo = String(formData.get('redirectTo') ?? '/');

		if (!email || !password) {
			return fail(400, { error: 'Enter your email and password.', mode: 'signup' });
		}
		if (password.length < 6) {
			return fail(400, { error: 'Password must be at least 6 characters.', mode: 'signup' });
		}

		const callback = new URL('/auth/callback', url.origin);
		callback.searchParams.set('redirectTo', redirectTo);

		const { data, error } = await supabase.auth.signUp({
			email,
			password,
			options: { emailRedirectTo: callback.toString() }
		});

		if (error) {
			return fail(400, { error: error.message, mode: 'signup' });
		}

		if (data.session) {
			throw redirect(303, redirectTo);
		}

		return { confirmEmail: true, email, mode: 'signup' };
	}
};
