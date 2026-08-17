import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { user } }) => {
	return { email: user!.email };
};

export const actions: Actions = {
	setPassword: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const password = String(formData.get('password') ?? '');

		if (password.length < 6) {
			return fail(400, { error: 'Password must be at least 6 characters.' });
		}

		const { error } = await supabase.auth.updateUser({ password });

		if (error) {
			return fail(400, { error: error.message });
		}

		return { saved: true };
	}
};
