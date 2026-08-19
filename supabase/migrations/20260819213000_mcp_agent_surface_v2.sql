-- MCP surface, second pass.
--
-- The agent-facing API had five structural problems, all fixed here:
--   * the only way to edit was to resend the whole body, with no way to
--     detect that the note had changed underneath you;
--   * lists carried full bodies, so one captured photo (a multi-megabyte
--     base64 data URL) would blow out an agent's context window;
--   * notes with no title came back as `title: ""` and nothing else, so a
--     list of them was unidentifiable;
--   * tags could be written but never read or filtered on;
--   * threads — the app's central idea — were invisible.

-- ---------------------------------------------------------------- helpers

-- Escape a user string for use inside an ILIKE pattern. Without this a query
-- containing % matches everything and one containing _ matches any character.
create or replace function public.mcp_escape_like(p_text text)
returns text language sql immutable
set search_path = ''
as $$
  select replace(replace(replace(coalesce(p_text, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- Does this body embed a photo as a base64 data URL?
create or replace function public.mcp_has_data_url(p_content text)
returns boolean language sql immutable
set search_path = ''
as $$
  select coalesce(p_content, '') ~ '!\[[^\]]*\]\(data:';
$$;

-- Embedded photos are megabytes of base64 that no agent can read, act on, or
-- reproduce. They come back as a marker instead; mcp_update_note refuses to
-- rewrite a body that has one, so the marker can never be written back.
create or replace function public.mcp_redact_data_urls(p_content text)
returns text language sql immutable
set search_path = ''
as $$
  select regexp_replace(coalesce(p_content, ''), '!\[[^\]]*\]\(data:[^)]*\)', '![photo]', 'g');
$$;

-- A handle for a note that always names it. 28 of 55 notes have no title, so
-- an agent listing them needs the same first-line label the app shows.
create or replace function public.mcp_label(p_title text, p_content text, p_source_title text)
returns text language sql immutable
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(coalesce(p_title, '')), ''),
    nullif(btrim(coalesce(p_source_title, '')), ''),
    nullif(
      left(
        btrim(
          regexp_replace(
            regexp_replace(
              regexp_replace(coalesce(p_content, ''), '!\[[^\]]*\]\([^)]*\)', ' ', 'g'),
              '[#>*_`~]', ' ', 'g'
            ),
            '\s+', ' ', 'g'
          )
        ),
        80
      ),
      ''
    ),
    '(untitled)'
  );
$$;

-- Everything a keyword should be able to match: the note's own text, its link
-- preview, and its tag names. Embedded photos are dropped rather than
-- searched — a base64 blob matches nothing a human would type.
create or replace function public.mcp_haystack(n public.notes)
returns text language sql stable
set search_path = 'public'
as $$
  select concat_ws(' ',
    n.title,
    n.source_title,
    n.source_description,
    n.source_url,
    regexp_replace(coalesce(n.content_markdown, ''), '!\[[^\]]*\]\(data:[^)]*\)', ' ', 'g'),
    (select string_agg(t.name, ' ')
       from public.note_tags nt join public.tags t on t.id = nt.tag_id
      where nt.note_id = n.id)
  );
$$;

-- ------------------------------------------------------------ token lookup

alter table public.api_tokens add column if not exists expires_at timestamptz;

create or replace function public.mcp_resolve_user(p_token text)
returns uuid language plpgsql security definer
set search_path = 'public', 'extensions'
as $$
declare
  v_hash text := encode(digest(p_token, 'sha256'), 'hex');
  v_user_id uuid;
  v_last_used timestamptz;
begin
  select user_id, last_used_at into v_user_id, v_last_used
    from public.api_tokens
   where token_hash = v_hash
     and (expires_at is null or expires_at > now());

  if v_user_id is null then
    raise exception 'invalid_token' using errcode = '28000';
  end if;

  -- Every tool call resolves a token, so an unconditional UPDATE here would
  -- turn every read (search, list, get) into a write, contending on the
  -- same row under concurrent agent calls. Coalescing to once a minute
  -- keeps last_used_at meaningful without that cost.
  if v_last_used is null or v_last_used < now() - interval '1 minute' then
    update public.api_tokens set last_used_at = now() where token_hash = v_hash;
  end if;

  return v_user_id;
end;
$$;

-- Ownership check plus optimistic concurrency, in one place. Passing the
-- updated_at you last read turns a blind overwrite into a rejected write:
-- if the note changed on the phone while the agent was composing a rewrite,
-- the agent is told to re-read rather than silently clobbering it.
create or replace function public.mcp_owned_note(
  p_user_id uuid,
  p_note_id uuid,
  p_if_updated_at timestamptz default null
) returns public.notes language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_note public.notes;
begin
  select * into v_note from public.notes where id = p_note_id and deleted_at is null;

  if v_note.id is null or v_note.user_id <> p_user_id then
    raise exception 'note_not_found' using errcode = 'P0002';
  end if;

  if p_if_updated_at is not null and v_note.updated_at <> p_if_updated_at then
    raise exception 'stale_write: note last changed at %, you passed %. Re-read the note and retry.',
      v_note.updated_at, p_if_updated_at using errcode = '40001';
  end if;

  return v_note;
end;
$$;

-- ------------------------------------------------------------- note as json

drop function if exists public.mcp_note_json(uuid);

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
    'thread_count', public.thread_count(n),
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

-- ------------------------------------------------------------------- reads

drop function if exists public.mcp_search_notes(text, text, integer);

create or replace function public.mcp_search_notes(
  p_token text,
  p_query text default '',
  p_tags text[] default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_archived text default 'exclude',
  p_full boolean default false
) returns jsonb language plpgsql security definer
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
       and (
         cardinality(v_tags) = 0
         or (
           select count(distinct t.name)
             from public.note_tags nt join public.tags t on t.id = nt.tag_id
            where nt.note_id = n.id and t.name = any(v_tags)
         ) = cardinality(v_tags)
       )
     order by n.updated_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  ) matched;

  return v_result;
end;
$$;

drop function if exists public.mcp_list_recent_notes(text, integer);

create or replace function public.mcp_list_recent_notes(
  p_token text,
  p_limit integer default 20,
  p_offset integer default 0,
  p_order text default 'updated',
  p_archived text default 'exclude',
  p_include_continuations boolean default false,
  p_full boolean default false
) returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_archived text := lower(coalesce(p_archived, 'exclude'));
  v_created boolean := lower(coalesce(p_order, 'updated')) = 'created';
  v_result jsonb;
begin
  select coalesce(jsonb_agg(public.mcp_note_json(id, p_full) order by sort_at desc), '[]'::jsonb)
    into v_result
  from (
    select n.id, case when v_created then n.created_at else n.updated_at end as sort_at
      from public.notes n
     where n.user_id = v_user_id
       and n.deleted_at is null
       and (case v_archived when 'only' then n.archived when 'include' then true else not n.archived end)
       and (p_include_continuations or n.parent_id is null)
     order by sort_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  ) recent;

  return v_result;
end;
$$;

drop function if exists public.mcp_get_note(text, uuid);

create or replace function public.mcp_get_note(
  p_token text,
  p_note_id uuid,
  p_full boolean default true
) returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_note public.notes := public.mcp_owned_note(v_user_id, p_note_id);
begin
  return public.mcp_note_json(p_note_id, p_full) || jsonb_build_object(
    'thread', coalesce((
      select jsonb_agg(public.mcp_note_json(c.id, p_full) order by c.created_at)
        from public.notes c
       where c.parent_id = p_note_id and c.deleted_at is null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.mcp_list_tags(p_token text)
returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc, name), '[]'::jsonb)
    into v_result
  from (
    select t.name,
           count(nt.note_id) filter (where nt.note_id is not null)::int as n
      from public.tags t
      left join public.note_tags nt on nt.tag_id = t.id
      left join public.notes note on note.id = nt.note_id
        and note.deleted_at is null and note.archived = false
     where t.user_id = v_user_id
     group by t.name
  ) counted;

  return v_result;
end;
$$;

-- ------------------------------------------------------------------ writes

drop function if exists public.mcp_create_note(text, text, text, text, text, text[]);

create or replace function public.mcp_create_note(
  p_token text,
  p_title text default '',
  p_content_markdown text default '',
  p_source_url text default null,
  p_source_type text default 'agent',
  p_tags text[] default array[]::text[],
  p_parent_id uuid default null,
  p_client_id uuid default null
) returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_note_id uuid;
  v_parent uuid;
  v_tag text;
  v_tag_id uuid;
begin
  -- A retried tool call must not create a second note. The app path already
  -- relies on notes_user_client_id_key for exactly this.
  if p_client_id is not null then
    select id into v_note_id from public.notes
     where user_id = v_user_id and client_id = p_client_id;
    if v_note_id is not null then
      return public.mcp_note_json(v_note_id);
    end if;
  end if;

  -- Threads are flat: continuing a continuation continues the thread it
  -- belongs to. Pointing at someone else's note is an error, not a silent
  -- reparent.
  if p_parent_id is not null then
    select coalesce(p.parent_id, p.id) into v_parent
      from public.notes p
     where p.id = p_parent_id and p.user_id = v_user_id and p.deleted_at is null;
    if v_parent is null then
      raise exception 'parent_not_found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.notes (user_id, client_id, parent_id, title, content_markdown, source_url, source_type)
  values (
    v_user_id, p_client_id, v_parent,
    coalesce(p_title, ''), coalesce(p_content_markdown, ''),
    p_source_url, coalesce(p_source_type, 'agent')
  )
  on conflict (user_id, client_id) where client_id is not null do nothing
  returning id into v_note_id;

  if v_note_id is null then
    -- A concurrent retry won the race; its row is the answer we owe.
    select id into v_note_id from public.notes
     where user_id = v_user_id and client_id = p_client_id;
    return public.mcp_note_json(v_note_id);
  end if;

  foreach v_tag in array coalesce(p_tags, array[]::text[]) loop
    if length(trim(v_tag)) = 0 then continue; end if;
    insert into public.tags (user_id, name) values (v_user_id, lower(trim(v_tag)))
      on conflict (user_id, name) do update set name = excluded.name
      returning id into v_tag_id;
    insert into public.note_tags (note_id, tag_id) values (v_note_id, v_tag_id)
      on conflict do nothing;
  end loop;

  return public.mcp_note_json(v_note_id);
end;
$$;

drop function if exists public.mcp_update_note(text, uuid, text, text, text, boolean, boolean);

create or replace function public.mcp_update_note(
  p_token text,
  p_note_id uuid,
  p_title text default null,
  p_content_markdown text default null,
  p_source_url text default null,
  p_pinned boolean default null,
  p_archived boolean default null,
  p_clear text[] default null,
  p_if_updated_at timestamptz default null
) returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_note public.notes := public.mcp_owned_note(v_user_id, p_note_id, p_if_updated_at);
  v_clear text[] := coalesce(p_clear, array[]::text[]);
begin
  -- MCP output shows an embedded photo as `![photo]`, so a whole-body rewrite
  -- built from what the agent read would delete the photo. Patch instead.
  if p_content_markdown is not null and public.mcp_has_data_url(v_note.content_markdown) then
    raise exception 'photo_note_needs_patch: this note embeds a photo that MCP output redacts to ![photo]; replacing the whole body would destroy it. Use replace_in_note or append_to_note.'
      using errcode = '22023';
  end if;

  update public.notes set
    title = case
      when 'title' = any(v_clear) then ''
      when p_title is not null then p_title
      else title end,
    content_markdown = case
      when 'content_markdown' = any(v_clear) then ''
      when p_content_markdown is not null then p_content_markdown
      else content_markdown end,
    source_url = case
      when 'source_url' = any(v_clear) then null
      when p_source_url is not null then p_source_url
      else source_url end,
    pinned = coalesce(p_pinned, pinned),
    archived = coalesce(p_archived, archived)
  where id = p_note_id;

  return public.mcp_note_json(p_note_id);
end;
$$;

drop function if exists public.mcp_append_to_note(text, uuid, text);

create or replace function public.mcp_append_to_note(
  p_token text,
  p_note_id uuid,
  p_content_markdown text,
  p_if_updated_at timestamptz default null
) returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_note public.notes := public.mcp_owned_note(v_user_id, p_note_id, p_if_updated_at);
begin
  update public.notes
     set content_markdown = case
       when length(trim(coalesce(v_note.content_markdown, ''))) = 0 then p_content_markdown
       else v_note.content_markdown || E'\n\n' || p_content_markdown
     end
   where id = p_note_id;

  return public.mcp_note_json(p_note_id);
end;
$$;

-- Patch-style editing: the whole reason update_note existed for one-character
-- changes. Ticking a checkbox is find '- [ ] Buy milk', replace '- [x] Buy milk'.
create or replace function public.mcp_replace_in_note(
  p_token text,
  p_note_id uuid,
  p_find text,
  p_replace text default '',
  p_all boolean default false,
  p_if_updated_at timestamptz default null
) returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_note public.notes;
  v_body text;
  v_hits int;
  v_pos int;
  v_new text;
begin
  if coalesce(p_find, '') = '' then
    raise exception 'empty_find: pass the exact text to replace' using errcode = '22023';
  end if;

  v_note := public.mcp_owned_note(v_user_id, p_note_id, p_if_updated_at);
  v_body := coalesce(v_note.content_markdown, '');
  v_hits := (length(v_body) - length(replace(v_body, p_find, ''))) / length(p_find);

  if v_hits = 0 then
    raise exception 'not_found_in_note: % does not appear in this note', left(p_find, 60)
      using errcode = 'P0002';
  end if;

  -- Ambiguity is a wrong edit waiting to happen: say so instead of guessing.
  if v_hits > 1 and not coalesce(p_all, false) then
    raise exception 'ambiguous_replace: that text appears % times; pass all=true or include more surrounding text', v_hits
      using errcode = '22023';
  end if;

  if coalesce(p_all, false) then
    v_new := replace(v_body, p_find, coalesce(p_replace, ''));
  else
    v_pos := position(p_find in v_body);
    v_new := left(v_body, v_pos - 1) || coalesce(p_replace, '') || substr(v_body, v_pos + length(p_find));
  end if;

  update public.notes set content_markdown = v_new where id = p_note_id;

  return public.mcp_note_json(p_note_id) || jsonb_build_object('replacements', case when coalesce(p_all, false) then v_hits else 1 end);
end;
$$;

drop function if exists public.mcp_tag_note(text, uuid, text[]);

create or replace function public.mcp_tag_note(p_token text, p_note_id uuid, p_tags text[])
returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_note public.notes := public.mcp_owned_note(v_user_id, p_note_id);
  v_tag text;
  v_tag_id uuid;
begin
  foreach v_tag in array coalesce(p_tags, array[]::text[]) loop
    if length(trim(v_tag)) = 0 then continue; end if;
    insert into public.tags (user_id, name) values (v_user_id, lower(trim(v_tag)))
      on conflict (user_id, name) do update set name = excluded.name
      returning id into v_tag_id;
    insert into public.note_tags (note_id, tag_id) values (p_note_id, v_tag_id)
      on conflict do nothing;
  end loop;

  return public.mcp_note_json(p_note_id);
end;
$$;

create or replace function public.mcp_untag_note(p_token text, p_note_id uuid, p_tags text[])
returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_note public.notes := public.mcp_owned_note(v_user_id, p_note_id);
  v_names text[] := (
    select coalesce(array_agg(lower(btrim(t))) filter (where btrim(t) <> ''), array[]::text[])
      from unnest(coalesce(p_tags, array[]::text[])) t
  );
begin
  delete from public.note_tags nt
   using public.tags t
   where nt.note_id = p_note_id
     and t.id = nt.tag_id
     and t.user_id = v_user_id
     and t.name = any(v_names);

  return public.mcp_note_json(p_note_id);
end;
$$;

-- Soft delete, like the app's own: the row keeps its place in the trash
-- rather than being erased. A thread head takes its thoughts with it, but
-- only when the caller says so out loud.
create or replace function public.mcp_delete_note(
  p_token text,
  p_note_id uuid,
  p_cascade boolean default false,
  p_if_updated_at timestamptz default null
) returns jsonb language plpgsql security definer
set search_path = 'public'
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_note public.notes := public.mcp_owned_note(v_user_id, p_note_id, p_if_updated_at);
  v_kids int := public.thread_count(v_note);
begin
  if v_kids > 0 and not coalesce(p_cascade, false) then
    raise exception 'thread_has_continuations: this note has % continuation(s); pass cascade=true to delete the whole thread', v_kids
      using errcode = '22023';
  end if;

  update public.notes set deleted_at = now()
   where deleted_at is null
     and user_id = v_user_id
     and (id = p_note_id or parent_id = p_note_id);

  return jsonb_build_object('deleted', p_note_id, 'continuations_deleted', v_kids);
end;
$$;

-- ------------------------------------------------------------- housekeeping

-- The stream's real query: newest activity first, live and unarchived. The
-- only ordered index was on created_at, which this query cannot use.
create index if not exists notes_user_updated_idx
  on public.notes (user_id, updated_at desc)
  where deleted_at is null and archived = false;

-- Advisor: function_search_path_mutable.
alter function public.preview(public.notes) set search_path = 'public';
alter function public.thread_count(public.notes) set search_path = 'public';
alter function public.notes_touch_parent() set search_path = 'public';
alter function public.notes_flatten_parent() set search_path = 'public';

-- Internal helpers stay callable only by the definer role, as before.
revoke all on function public.mcp_note_json(uuid, boolean) from public;
revoke all on function public.mcp_resolve_user(text) from public;
revoke all on function public.mcp_owned_note(uuid, uuid, timestamptz) from public;
revoke all on function public.mcp_label(text, text, text) from public;
revoke all on function public.mcp_redact_data_urls(text) from public;
revoke all on function public.mcp_has_data_url(text) from public;
revoke all on function public.mcp_escape_like(text) from public;
revoke all on function public.mcp_haystack(public.notes) from public;
