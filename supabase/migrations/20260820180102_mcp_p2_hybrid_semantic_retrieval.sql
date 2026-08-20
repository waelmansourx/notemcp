-- P2 semantic retrieval and on-demand MCP image assets.
--
-- Keyword retrieval remains untouched. Semantic search is an additional RPC
-- over a private pgvector table, and the application combines the two ranked
-- lists for hybrid mode. Embeddings are generated lazily by a service-only
-- Edge Function using Supabase's built-in gte-small model.

create extension if not exists vector with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.mcp_note_embeddings (
  note_id uuid primary key references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content_hash text not null,
  embedding extensions.vector(384) not null,
  embedded_at timestamptz not null default now()
);

alter table private.mcp_note_embeddings enable row level security;
revoke all on private.mcp_note_embeddings from public, anon, authenticated;

create index if not exists mcp_note_embeddings_user_idx
  on private.mcp_note_embeddings (user_id);

-- Inner product is appropriate because gte-small is invoked with normalize=true.
create index if not exists mcp_note_embeddings_hnsw_idx
  on private.mcp_note_embeddings
  using hnsw (embedding extensions.vector_ip_ops);

-- Build one bounded embedding document with deliberate field budgets. This
-- prevents a long imported caption from crowding out the user's words while
-- still making source context semantically discoverable. A duplicated share
-- title is represented only as source identity, never twice.
create or replace function public.mcp_embedding_document(p_note_id uuid)
returns jsonb language sql security definer
set search_path = ''
as $$
  with note_data as (
    select
      n.id,
      n.user_id,
      n.updated_at,
      left(public.mcp_redact_data_urls(coalesce(n.content_markdown, '')), 800) as user_text,
      left(coalesce(string_agg(t.name, ' ' order by t.name), ''), 240) as tags,
      left(
        case
          when n.source_type = 'share'
           and nullif(btrim(n.source_title), '') is not null
           and btrim(n.title) = btrim(n.source_title)
            then ''
          else coalesce(n.title, '')
        end,
        180
      ) as authored_title,
      left(coalesce(n.source_title, ''), 180) as source_title,
      left(coalesce(n.source_description, ''), 220) as source_description
    from public.notes n
    left join public.note_tags nt on nt.note_id = n.id
    left join public.tags t on t.id = nt.tag_id
    where n.id = p_note_id
    group by n.id
  ), weighted as (
    select
      id,
      user_id,
      updated_at,
      concat_ws(E'\n\n',
        case when user_text <> '' then 'User text (highest priority):' || E'\n' || user_text end,
        case when tags <> '' then 'Tags (high priority):' || E'\n' || tags || E'\n' || tags end,
        case when authored_title <> '' then 'Title:' || E'\n' || authored_title end,
        case when source_title <> '' then 'Source title:' || E'\n' || source_title end,
        case when source_description <> '' then 'Source context (lower priority):' || E'\n' || source_description end,
        case when user_text <> '' then 'User text emphasis:' || E'\n' || left(user_text, 240) end
      ) as input
    from note_data
  )
  select jsonb_build_object(
    'id', id,
    'updated_at', updated_at,
    'content_hash', encode(extensions.digest(input, 'sha256'), 'hex'),
    'input', input
  )
  from weighted;
$$;

-- Service-only work queue view. It returns only stale documents belonging to
-- the token owner; there is no public table or cross-user batch endpoint.
create or replace function public.mcp_list_pending_embeddings(
  p_token text,
  p_limit integer default 200
)
returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_result jsonb;
begin
  select coalesce(jsonb_agg(document order by updated_at desc), '[]'::jsonb)
    into v_result
  from (
    select d.document, n.updated_at
    from public.notes n
    cross join lateral (select public.mcp_embedding_document(n.id) as document) d
    left join private.mcp_note_embeddings e on e.note_id = n.id
    where n.user_id = v_user_id
      and n.deleted_at is null
      and nullif(d.document->>'input', '') is not null
      and (e.note_id is null or e.content_hash <> d.document->>'content_hash')
    order by n.updated_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 500)
  ) pending;

  return v_result;
end;
$$;

-- Reject stale writes: if a note changed while inference was running, its old
-- vector is never installed and the next semantic request will retry it.
create or replace function public.mcp_store_note_embedding(
  p_token text,
  p_note_id uuid,
  p_content_hash text,
  p_embedding extensions.vector(384)
)
returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_document jsonb;
begin
  select public.mcp_embedding_document(n.id)
    into v_document
  from public.notes n
  where n.id = p_note_id
    and n.user_id = v_user_id
    and n.deleted_at is null;

  if v_document is null then
    raise exception 'Note not found' using errcode = 'P0002';
  end if;

  if v_document->>'content_hash' <> p_content_hash then
    return jsonb_build_object('stored', false, 'reason', 'stale');
  end if;

  insert into private.mcp_note_embeddings (
    note_id, user_id, content_hash, embedding, embedded_at
  ) values (
    p_note_id, v_user_id, p_content_hash, p_embedding, now()
  )
  on conflict (note_id) do update set
    user_id = excluded.user_id,
    content_hash = excluded.content_hash,
    embedding = excluded.embedding,
    embedded_at = excluded.embedded_at;

  return jsonb_build_object('stored', true);
end;
$$;

-- Same deterministic filters as keyword retrieval, pushed inside the vector
-- query so ownership and metadata filtering happen before ranking/limiting.
create or replace function public.mcp_search_notes_semantic(
  p_token text,
  p_query_embedding extensions.vector(384),
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
  select coalesce(
    jsonb_agg(public.mcp_note_json(id, p_full) order by distance, updated_at desc),
    '[]'::jsonb
  ) into v_result
  from (
    select n.id, n.updated_at,
      e.embedding OPERATOR(extensions.<#>) p_query_embedding as distance
    from private.mcp_note_embeddings e
    join public.notes n on n.id = e.note_id
    where e.user_id = v_user_id
      and n.user_id = v_user_id
      and n.deleted_at is null
      and (case v_archived when 'only' then n.archived when 'include' then true else not n.archived end)
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
      and (v_source_domain is null or public.mcp_source_domain(n.source_url) = v_source_domain)
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
      and (p_created_after is null or n.created_at >= p_created_after)
      and (p_created_before is null or n.created_at < p_created_before)
      and (p_updated_after is null or n.updated_at >= p_updated_after)
      and (p_updated_before is null or n.updated_at < p_updated_before)
      and (p_root_id is null or n.id = p_root_id or n.parent_id = p_root_id)
    order by e.embedding OPERATOR(extensions.<#>) p_query_embedding, n.updated_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  ) matched;

  return v_result;
end;
$$;

-- Resolve an image only through a note already owned by the token holder.
-- The caller chooses a semantic slot and index, never a URL or object key.
create or replace function public.mcp_get_note_asset_descriptor(
  p_token text,
  p_note_id uuid,
  p_asset text default 'source',
  p_index integer default 0
)
returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_note public.notes%rowtype;
  v_media public.media%rowtype;
  v_asset text := lower(coalesce(p_asset, 'source'));
  v_source_hash text;
begin
  if p_index is null or p_index < 0 or p_index > 20 then
    raise exception 'Asset index must be between 0 and 20' using errcode = '22023';
  end if;

  select * into v_note
  from public.notes
  where id = p_note_id and user_id = v_user_id and deleted_at is null;

  if not found then
    raise exception 'Note not found' using errcode = 'P0002';
  end if;

  if v_asset = 'source' then
    if p_index <> 0
      or nullif(btrim(v_note.source_image), '') is null
      or v_note.source_image like 'data:%'
    then
      raise exception 'Source image not found' using errcode = 'P0002';
    end if;

    v_source_hash := encode(extensions.digest(v_note.source_image, 'sha256'), 'hex');
    return jsonb_build_object(
      'note_id', v_note.id,
      'asset', 'source',
      'index', 0,
      'kind', 'remote',
      'url', v_note.source_image,
      'cache_key', v_user_id::text || '/mcp-assets/' || v_note.id::text || '/source-' || v_source_hash || '.webp'
    );
  elsif v_asset = 'body' then
    select m.* into v_media
    from regexp_matches(
      coalesce(v_note.content_markdown, ''),
      '/api/media/([0-9a-fA-F-]{36})',
      'g'
    ) with ordinality as found(parts, position)
    join public.media m
      on m.id = found.parts[1]::uuid
     and m.user_id = v_user_id
     and m.kind = 'image'
    order by found.position
    offset p_index
    limit 1;

    if not found then
      raise exception 'Body image not found' using errcode = 'P0002';
    end if;

    return jsonb_build_object(
      'note_id', v_note.id,
      'asset', 'body',
      'index', p_index,
      'kind', 'r2',
      'r2_key', v_media.r2_key,
      'mime_type', v_media.mime_type,
      'cache_key', v_user_id::text || '/mcp-assets/' || v_note.id::text || '/body-' || v_media.id::text || '.webp'
    );
  else
    raise exception 'Asset must be source or body' using errcode = '22023';
  end if;
end;
$$;

-- P1's compact photo predicate includes current /api/media references; use it
-- in rich note metadata as well (the prior function only checked data URLs).
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
      'has_photos', public.mcp_has_photos(n.content_markdown)
    )
    else '{}'::jsonb
  end
  from public.notes n
  where n.id = p_note_id;
$$;

revoke all on function public.mcp_embedding_document(uuid) from public, anon, authenticated;
revoke all on function public.mcp_list_pending_embeddings(text, integer) from public, anon, authenticated;
revoke all on function public.mcp_store_note_embedding(text, uuid, text, extensions.vector) from public, anon, authenticated;
revoke all on function public.mcp_search_notes_semantic(
  text, extensions.vector, text[], integer, integer, text, boolean,
  text, text, boolean, boolean,
  timestamptz, timestamptz, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.mcp_get_note_asset_descriptor(text, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.mcp_note_json(uuid, boolean) from public, anon, authenticated;

grant execute on function public.mcp_list_pending_embeddings(text, integer) to service_role;
grant execute on function public.mcp_store_note_embedding(text, uuid, text, extensions.vector) to service_role;
grant execute on function public.mcp_search_notes_semantic(
  text, extensions.vector, text[], integer, integer, text, boolean,
  text, text, boolean, boolean,
  timestamptz, timestamptz, timestamptz, timestamptz, uuid
) to service_role;
grant execute on function public.mcp_get_note_asset_descriptor(text, uuid, text, integer) to service_role;
