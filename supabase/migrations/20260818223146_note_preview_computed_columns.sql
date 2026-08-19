-- A note with a photo in it *is* a megabytes-long base64 data URL. Anywhere
-- we only ever wanted a preview, asking for `content_markdown` meant shipping
-- those bytes to the browser to throw them away. These are PostgREST computed
-- columns, so a list query can ask for `preview` and never touch the body.
create or replace function public.preview(n public.notes)
returns text
language sql
stable
as $$
	select left(
		btrim(
			regexp_replace(
				regexp_replace(n.content_markdown, '!\[[^\]]*\]\([^)]*\)', ' ', 'g'),
				'\s+', ' ', 'g'
			)
		),
		200
	);
$$;

-- How many thoughts have been added to this one. Lets a list row say "3
-- thoughts" without loading the thread.
create or replace function public.thread_count(n public.notes)
returns integer
language sql
stable
as $$
	select count(*)::int
	from public.notes c
	where c.parent_id = n.id
		and c.deleted_at is null;
$$;

grant execute on function public.preview(public.notes) to anon, authenticated;
grant execute on function public.thread_count(public.notes) to anon, authenticated;
