-- `has_photos` is the discovery switch for images an MCP client can inspect,
-- not only images embedded in the authored body. A stored HTTPS source
-- thumbnail (Instagram/link previews) is addressable through
-- get_note_asset(asset = 'source'), so it belongs in the same result set.
-- Keep the one-argument helper as the body-only predicate used for legacy
-- data-URL rewrite protection; this overload is the note-level predicate.
create or replace function public.mcp_has_photos(
  p_content text,
  p_source_image text
)
returns boolean language sql immutable parallel safe
set search_path = ''
as $$
  select public.mcp_has_photos(p_content)
    or (
      nullif(btrim(p_source_image), '') is not null
      and p_source_image not like 'data:%'
      and p_source_image ~* '^https://'
    );
$$;

-- These functions are lengthy and already defined canonically by the prior
-- P1/P2 migrations. Replace only their note-image predicate so keyword,
-- semantic/hybrid, and rich-note metadata cannot drift from one another.
do $$
declare
  v_function record;
  v_definition text;
  v_updated integer := 0;
begin
  for v_function in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('mcp_search_notes', 'mcp_search_notes_semantic', 'mcp_note_json')
  loop
    v_definition := pg_get_functiondef(v_function.oid);
    if position('public.mcp_has_photos(n.content_markdown)' in v_definition) = 0 then
      raise exception 'Expected photo predicate was not found in MCP retrieval function %', v_function.oid;
    end if;
    execute replace(
      v_definition,
      'public.mcp_has_photos(n.content_markdown)',
      'public.mcp_has_photos(n.content_markdown, n.source_image)'
    );
    v_updated := v_updated + 1;
  end loop;

  if v_updated <> 3 then
    raise exception 'Expected to update 3 MCP retrieval functions, updated %', v_updated;
  end if;
end;
$$;

revoke all on function public.mcp_has_photos(text, text) from public, anon, authenticated;
grant execute on function public.mcp_has_photos(text, text) to service_role;
