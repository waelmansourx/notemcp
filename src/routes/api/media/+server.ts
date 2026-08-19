import { json, error } from '@sveltejs/kit';
import { presignPut } from '$lib/server/r2';
import { extensionFor, maxBytesFor, type MediaKind } from '$lib/server/media';
import type { RequestHandler } from './$types';

// Step 1 of the upload: the client tells us what it's about to send, we
// hand back a presigned PUT URL scoped to its own key prefix and a row
// tracking that this upload was started. The actual bytes never pass
// through this server — see ADR-001.
export const POST: RequestHandler = async ({ request, locals: { supabase, user } }) => {
	if (!user) throw error(401, 'Not authenticated');

	const body = await request.json();
	const kind = body.kind as MediaKind;
	const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
	const byteSize = Number(body.byteSize);

	if (kind !== 'image' && kind !== 'audio') throw error(400, 'kind must be image or audio');

	const ext = extensionFor(kind, mimeType);
	if (!ext) throw error(400, `Unsupported ${kind} type: ${mimeType}`);

	if (!Number.isFinite(byteSize) || byteSize <= 0) throw error(400, 'byteSize is required');
	if (byteSize > maxBytesFor(kind)) throw error(413, `${kind} exceeds the size limit`);

	const id = crypto.randomUUID();
	const key = `${user.id}/${id}.${ext}`;

	const { error: insertError } = await supabase
		.from('media')
		.insert({ id, user_id: user.id, kind, mime_type: mimeType, byte_size: byteSize, r2_key: key });

	if (insertError) throw error(500, insertError.message);

	const uploadUrl = await presignPut(key, mimeType);

	return json({ id, uploadUrl }, { status: 201 });
};
