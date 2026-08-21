-- Compact shelves need a thumbnail without loading a note's full markdown.
-- Prefer a saved link/source thumbnail; otherwise expose the first embedded
-- image only when it is a stable URL. Legacy data: images stay deliberately
-- excluded because returning them would put megabytes back into list queries.
create or replace function public.preview_image(n public.notes)
returns text
language sql
stable
as $$
	select coalesce(
		nullif(btrim(n.source_image), ''),
		case
			when substring(n.content_markdown from '!\[[^\]]*\]\(([^)]+)\)') ~* '^(https?://|/api/media/)'
			then substring(n.content_markdown from '!\[[^\]]*\]\(([^)]+)\)')
			else null
		end
	);
$$;

grant execute on function public.preview_image(public.notes) to anon, authenticated;
