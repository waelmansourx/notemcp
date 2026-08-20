-- Tag paths.
--
-- A `/` in a tag name is a convention, not a structure: there is still no
-- parent column on `tags` and nothing to migrate. What changes is what a tag
-- *means* when you filter by it — `#notemcp` now covers everything filed
-- beneath it, so a note tagged `#notemcp/bug/share` answers a search for
-- `#notemcp` and for `#notemcp/bug` as well.
--
-- Without this the agent and the app disagree: the same tag returns different
-- notes over MCP than it does on screen, which is the kind of difference that
-- makes an agent quietly wrong rather than obviously broken.
--
-- Matching is by segment, never raw prefix: `#note` must not swallow
-- `#notemcp`, which is why the pattern is `name = tag or name like tag || '/%'`
-- rather than `name like tag || '%'`.

create or replace function public.mcp_search_notes(
  p_token text,
  p_query text default '',
  p_tags text[] default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_archived text default 'exclude',
  p_full boolean default false
)
returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_terms text[] := coalesce(
    nullif(regexp_split_to_array(btrim(coalesce(p_query, '')), '\s+'), array['']),
    array[]::text[]
  );
  v_tags text[] := (
    select coalesce(array_agg(lower(btrim(t))) filter (where btrim(t) <> ''), array[]::text[])
      from unnest(coalesce(p_tags, array[]::text[])) t
  );
  v_archived text := lower(coalesce(p_archived, 'exclude'));
  v_result jsonb;
begin
  select coalesce(jsonb_agg(public.mcp_note_json(id, p_full) order by updated_at desc), '[]'::jsonb)
    into v_result
  from (
    select n.id, n.updated_at
      from public.notes n
      -- One haystack per candidate row, not one per search term — and skip
      -- building it at all when there's no query text to test it against
      -- (a tag-only search, or a plain listing through this RPC).
      cross join lateral (
        select case when cardinality(v_terms) = 0 then null else public.mcp_haystack(n) end as hay
      ) h
     where n.user_id = v_user_id
       and n.deleted_at is null
       and (case v_archived when 'only' then n.archived when 'include' then true else not n.archived end)
       -- every word must appear somewhere, in any order: "note takes time"
       -- finds a note that says all three, not only that exact phrase.
       and (
         cardinality(v_terms) = 0
         or not exists (
           select 1 from unnest(v_terms) term
            where h.hay not ilike '%' || public.mcp_escape_like(term) || '%'
         )
       )
       -- Every requested tag must match one of the note's own tags, where a
       -- tag matches any contiguous run of whole levels it names: 'notemcp'
       -- and 'bug' and 'bug/share' all match 'notemcp/bug/share'. Searching
       -- the broad end of a path finds the branch; searching the narrow end
       -- finds that type across every project.
       --
       -- Phrased as "no requested tag is left unmatched" so narrowing with a
       -- second tag still means AND, the way it does in the app. The four
       -- patterns are whole-segment by construction, so 'nm' cannot match
       -- 'nmextra'.
       and (
         cardinality(v_tags) = 0
         or not exists (
           select 1
             from unnest(v_tags) ft
            cross join lateral (select public.mcp_escape_like(ft) as e) esc
            where not exists (
              select 1
                from public.note_tags nt
                join public.tags t on t.id = nt.tag_id
               where nt.note_id = n.id
                 and (
                   t.name = ft
                   or t.name like esc.e || '/%'
                   or t.name like '%/' || esc.e
                   or t.name like '%/' || esc.e || '/%'
                 )
            )
         )
       )
     order by n.updated_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  ) matched;

  return v_result;
end;
$$;

-- `list_tags` is how an agent discovers what to filter by, so it has to show
-- the levels as places too. A store whose only tag is `#notemcp/bug/share`
-- would otherwise offer one option and hide the two broader ones that
-- `search_notes` now understands.
--
-- Counts roll up the same way the app's do, and are distinct per note: a note
-- carrying both `#notemcp/bug` and `#notemcp/idea` counts once for `#notemcp`,
-- because the number means "notes you would get", not "tags".
create or replace function public.mcp_list_tags(p_token text)
returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_result jsonb;
begin
  select coalesce(
           jsonb_agg(jsonb_build_object('name', path, 'count', n) order by n desc, path),
           '[]'::jsonb
         )
    into v_result
  from (
    select paths.path, count(distinct nt.note_id)::int as n
      from public.tags t
      join public.note_tags nt on nt.tag_id = t.id
      join public.notes note on note.id = nt.note_id
       and note.deleted_at is null
       and note.archived = false
      -- Every prefix of the tag: 'a/b/c' -> 'a', 'a/b', 'a/b/c'.
      cross join lateral (
        select array_to_string(
                 (string_to_array(t.name, '/'))[1:depth.i],
                 '/'
               ) as path
          from generate_series(1, cardinality(string_to_array(t.name, '/'))) as depth(i)
      ) paths
     where t.user_id = v_user_id
       and paths.path <> ''
     group by paths.path
  ) counted;

  return v_result;
end;
$$;
