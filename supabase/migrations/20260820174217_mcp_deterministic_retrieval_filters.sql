-- P1 deterministic retrieval.
--
-- Search remains keyword-first, but callers can now constrain candidates by
-- source identity, date range, photo presence, or thread without smuggling
-- those concepts into the text query. This migration also makes a note's flat
-- thread relationship explicit and corrects tag filtering to path-prefix
-- semantics: `features` covers `features/main`, while `main` does not.

-- Hostname extraction shared by filtering and its expression index. Stored
-- source URLs are normal http(s) URLs, but keeping this generic over schemes
-- also handles older imported rows without a data migration.
create or replace function public.mcp_source_domain(p_url text)
returns text language sql immutable parallel safe
set search_path = ''
as $$
  select nullif(
    lower(
      regexp_replace(
        substring(
          btrim(coalesce(p_url, ''))
          from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#:]+)'
        ),
        '^www\.',
        '',
        'i'
      )
    ),
    ''
  );
$$;

-- Retrieval should consider both legacy embedded data URLs and current R2
-- `/api/media/...` references to be photos. The existing mcp_has_data_url
-- helper remains unchanged because it specifically governs body redaction and
-- destructive-rewrite protection for hidden base64 data.
create or replace function public.mcp_has_photos(p_content text)
returns boolean language sql immutable parallel safe
set search_path = ''
as $$
  select coalesce(p_content, '') ~ '!\[[^]]*\]\([^)]+\)';
$$;

-- Tag hierarchy is path-prefix hierarchy, never arbitrary segment matching.
-- Escaping keeps literal `%`, `_`, and `\` characters from becoming patterns.
create or replace function public.mcp_tag_covers(p_filter text, p_tag text)
returns boolean language sql immutable parallel safe
set search_path = ''
as $$
  with normalized as (
    select
      nullif(lower(btrim(coalesce(p_filter, ''))), '') as filter,
      lower(btrim(coalesce(p_tag, ''))) as tag
  ), escaped as (
    select
      filter,
      tag,
      replace(replace(replace(filter, '\', '\\'), '%', '\%'), '_', '\_') as pattern
    from normalized
  )
  select coalesce(tag = filter or tag like pattern || '/%', false)
  from escaped;
$$;

-- Every returned note identifies its flat thread. A continuation's
-- thread_count is the count on its head, not zero merely because continuations
-- cannot themselves have children.
create or replace function public.mcp_note_json(p_note_id uuid, p_full boolean default true)
returns jsonb language sql security definer
set search_path = 'public'
as $$
  select jsonb_build_object(
    'id', n.id,
    'label', public.mcp_label(n.title, n.content_markdown, n.source_title),
    'title', n.title,
    'preview', public.preview(n),
    'source_url', n.source_url,
    'source_type', n.source_type,
    'source_title', n.source_title,
    'source_description', n.source_description,
    'source_image', case when n.source_image like 'data:%' then null else n.source_image end,
    'pinned', n.pinned,
    'archived', n.archived,
    'parent_id', n.parent_id,
    'root_id', coalesce(n.parent_id, n.id),
    'is_thread_head', n.parent_id is null,
    'thread_count', coalesce((
      select public.thread_count(root)
        from public.notes root
       where root.id = coalesce(n.parent_id, n.id)
    ), 0),
    'tags', coalesce((
      select array_agg(t.name order by t.name)
        from public.note_tags nt join public.tags t on t.id = nt.tag_id
       where nt.note_id = n.id
    ), array[]::text[]),
    'created_at', n.created_at,
    'updated_at', n.updated_at
  ) || case
    when p_full then jsonb_build_object(
      'content_markdown', public.mcp_redact_data_urls(n.content_markdown),
      'has_photos', public.mcp_has_data_url(n.content_markdown)
    )
    else '{}'::jsonb
  end
  from public.notes n
  where n.id = p_note_id;
$$;

-- Adding optional arguments changes the Postgres function identity, so remove
-- the superseded signature rather than leaving an ambiguous RPC overload.
drop function if exists public.mcp_search_notes(
  text, text, text[], integer, integer, text, boolean
);

create or replace function public.mcp_search_notes(
  p_token text,
  p_query text default '',
  p_tags text[] default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_archived text default 'exclude',
  p_full boolean default false,
  p_source_type text default null,
  p_source_domain text default null,
  p_has_source boolean default null,
  p_has_photos boolean default null,
  p_created_after timestamptz default null,
  p_created_before timestamptz default null,
  p_updated_after timestamptz default null,
  p_updated_before timestamptz default null,
  p_root_id uuid default null
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
  v_source_type text := nullif(lower(btrim(coalesce(p_source_type, ''))), '');
  v_source_domain text := case
    when nullif(btrim(coalesce(p_source_domain, '')), '') is null then null
    else coalesce(
      public.mcp_source_domain(
        case
          when position('://' in p_source_domain) > 0 then p_source_domain
          else 'https://' || p_source_domain
        end
      ),
      lower(regexp_replace(btrim(p_source_domain), '^www\.', '', 'i'))
    )
  end;
  v_result jsonb;
begin
  select coalesce(jsonb_agg(public.mcp_note_json(id, p_full) order by updated_at desc), '[]'::jsonb)
    into v_result
  from (
    select n.id, n.updated_at
      from public.notes n
      cross join lateral (
        select case when cardinality(v_terms) = 0 then null else public.mcp_haystack(n) end as hay
      ) h
     where n.user_id = v_user_id
       and n.deleted_at is null
       and (case v_archived when 'only' then n.archived when 'include' then true else not n.archived end)
       and (
         cardinality(v_terms) = 0
         or not exists (
           select 1 from unnest(v_terms) term
            where h.hay not ilike '%' || public.mcp_escape_like(term) || '%'
         )
       )
       -- Normal tag filtering is hierarchical path-prefix matching. Each
       -- requested tag must match exactly or cover a descendant. Segment
       -- matching is deliberately not part of this operation.
       and (
         cardinality(v_tags) = 0
         or not exists (
           select 1
             from unnest(v_tags) ft
            where not exists (
              select 1
                from public.note_tags nt
                join public.tags t on t.id = nt.tag_id
               where nt.note_id = n.id
                 and public.mcp_tag_covers(ft, t.name)
            )
         )
       )
       and (v_source_type is null or lower(n.source_type) = v_source_type)
       and (
         v_source_domain is null
         or public.mcp_source_domain(n.source_url) = v_source_domain
       )
       and (
         p_has_source is null
         or (
           coalesce(
             nullif(btrim(n.source_url), ''),
             nullif(btrim(n.source_title), ''),
             nullif(btrim(n.source_description), ''),
             nullif(btrim(n.source_image), '')
           ) is not null
         ) = p_has_source
       )
       and (p_has_photos is null or public.mcp_has_photos(n.content_markdown) = p_has_photos)
       -- Date windows are half-open: inclusive lower bound, exclusive upper
       -- bound. Adjacent windows can therefore be paged without duplicates.
       and (p_created_after is null or n.created_at >= p_created_after)
       and (p_created_before is null or n.created_at < p_created_before)
       and (p_updated_after is null or n.updated_at >= p_updated_after)
       and (p_updated_before is null or n.updated_at < p_updated_before)
       and (p_root_id is null or n.id = p_root_id or n.parent_id = p_root_id)
     order by n.updated_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  ) matched;

  return v_result;
end;
$$;

-- The source/date filters begin with user ownership and operate only on live
-- rows. Equality columns lead their indexes; the ranged timestamp is last.
create index if not exists notes_user_source_type_live_idx
  on public.notes (user_id, lower(source_type))
  where deleted_at is null;

create index if not exists notes_user_source_domain_live_idx
  on public.notes (user_id, public.mcp_source_domain(source_url))
  where deleted_at is null and source_url is not null;

create index if not exists notes_user_live_updated_idx
  on public.notes (user_id, updated_at desc)
  where deleted_at is null;

-- Internal helpers remain internal. mcp_source_domain is also used by an
-- expression index, so authenticated note inserts need EXECUTE on that pure
-- function; it accepts only caller-provided text and reads no data.
revoke all on function public.mcp_source_domain(text) from public, anon;
grant execute on function public.mcp_source_domain(text) to authenticated, service_role;
revoke all on function public.mcp_has_photos(text) from public, anon, authenticated;
revoke all on function public.mcp_tag_covers(text, text) from public, anon, authenticated;
revoke all on function public.mcp_note_json(uuid, boolean) from public, anon, authenticated;
revoke all on function public.mcp_search_notes(
  text, text, text[], integer, integer, text, boolean,
  text, text, boolean, boolean,
  timestamptz, timestamptz, timestamptz, timestamptz, uuid
) from public, anon, authenticated;

grant execute on function public.mcp_search_notes(
  text, text, text[], integer, integer, text, boolean,
  text, text, boolean, boolean,
  timestamptz, timestamptz, timestamptz, timestamptz, uuid
) to service_role;
