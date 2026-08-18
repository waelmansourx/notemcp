import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/*
 * A tag no longer has a page of its own — it's a filter on the stream. This
 * route stays so that anything already pointing at /tags/<name> (a bookmark, a
 * PWA shortcut, a link in an older note) lands somewhere useful instead of on
 * the 404 this page used to throw.
 */
export const load: PageServerLoad = ({ params }) => {
	redirect(308, `/?tag=${encodeURIComponent(params.name.toLowerCase())}`);
};
