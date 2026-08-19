import { error, json, redirect } from '@sveltejs/kit';
import { deleteObject, objectExists, presignGet } from '$lib/server/r2';
import type { RequestHandler } from './$types';

async function ownRow(supabase: App.Locals['supabase'], userId: string, id: string) {
	const { data } = await supabase
		.from('media')
		.select('id, r2_key, status')
		.eq('id', id)
		.eq('user_id', userId)
		.maybeSingle();
	return data;
}

// Step 2 of the upload: the client PUT the bytes straight to R2, then calls
// this to confirm. We HEAD the object rather than trusting the client, so a
// row never reads as "committed" for an upload that actually failed partway.
export const PUT: RequestHandler = async ({ params, locals: { supabase, user } }) => {
	if (!user) throw error(401, 'Not authenticated');

	const row = await ownRow(supabase, user.id, params.id!);
	if (!row) throw error(404, 'Not found');

	if (row.status !== 'committed') {
		const exists = await objectExists(row.r2_key);
		if (!exists) throw error(409, 'Upload has not landed in R2 yet');

		const { error: updateError } = await supabase
			.from('media')
			.update({ status: 'committed' })
			.eq('id', row.id);
		if (updateError) throw error(500, updateError.message);
	}

	return json({ id: row.id, url: `/api/media/${row.id}` });
};

// Owner-only redirect to a freshly minted, short-lived GET URL — media is
// never served from a permanent public link (see ADR-001, Option C).
//
// A note can reference this id before the upload's confirm PUT has landed —
// the id is handed out (and embedded) right after signing, so the client
// never has to fall back to base64 while the bytes are still in flight. So
// an uncommitted row isn't necessarily missing: HEAD the object before
// giving up, and commit it here if it turns out to already be there.
export const GET: RequestHandler = async ({ params, locals: { supabase, user } }) => {
	if (!user) throw error(401, 'Not authenticated');

	const row = await ownRow(supabase, user.id, params.id!);
	if (!row) throw error(404, 'Not found');

	if (row.status !== 'committed') {
		const exists = await objectExists(row.r2_key);
		if (!exists) throw error(404, 'Not found');
		await supabase.from('media').update({ status: 'committed' }).eq('id', row.id);
	}

	const url = await presignGet(row.r2_key);
	throw redirect(302, url);
};

export const DELETE: RequestHandler = async ({ params, locals: { supabase, user } }) => {
	if (!user) throw error(401, 'Not authenticated');

	const row = await ownRow(supabase, user.id, params.id!);
	if (!row) throw error(404, 'Not found');

	await deleteObject(row.r2_key);

	const { error: deleteError } = await supabase.from('media').delete().eq('id', row.id);
	if (deleteError) throw error(500, deleteError.message);

	return json({ ok: true });
};
