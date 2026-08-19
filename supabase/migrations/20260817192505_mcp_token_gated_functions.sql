
create extension if not exists pgcrypto;

create or replace function public.mcp_resolve_user(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := encode(digest(p_token, 'sha256'), 'hex');
  v_user_id uuid;
begin
  select user_id into v_user_id from public.api_tokens where token_hash = v_hash;
  if v_user_id is null then
    raise exception 'invalid_token' using errcode = '28000';
  end if;
  update public.api_tokens set last_used_at = now() where token_hash = v_hash;
  return v_user_id;
end;
$$;

revoke execute on function public.mcp_resolve_user(text) from public;

create or replace function public.mcp_note_json(p_note_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', n.id,
    'title', n.title,
    'content_markdown', n.content_markdown,
    'source_url', n.source_url,
    'source_type', n.source_type,
    'pinned', n.pinned,
    'archived', n.archived,
    'tags', coalesce((
      select array_agg(t.name order by t.name)
      from public.note_tags nt join public.tags t on t.id = nt.tag_id
      where nt.note_id = n.id
    ), array[]::text[]),
    'created_at', n.created_at,
    'updated_at', n.updated_at
  )
  from public.notes n
  where n.id = p_note_id;
$$;

revoke execute on function public.mcp_note_json(uuid) from public;

create or replace function public.mcp_list_recent_notes(p_token text, p_limit int default 20)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_result jsonb;
begin
  select coalesce(jsonb_agg(public.mcp_note_json(id) order by created_at desc), '[]'::jsonb) into v_result
  from (
    select id, created_at from public.notes
    where user_id = v_user_id and deleted_at is null
    order by created_at desc
    limit least(greatest(p_limit,1),100)
  ) recent;
  return v_result;
end;
$$;

create or replace function public.mcp_search_notes(p_token text, p_query text, p_limit int default 20)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_result jsonb;
  v_pattern text := '%' || p_query || '%';
begin
  select coalesce(jsonb_agg(public.mcp_note_json(id) order by created_at desc), '[]'::jsonb) into v_result
  from (
    select distinct n.id, n.created_at
    from public.notes n
    left join public.note_tags nt on nt.note_id = n.id
    left join public.tags t on t.id = nt.tag_id
    where n.user_id = v_user_id
      and n.deleted_at is null
      and (n.title ilike v_pattern or n.content_markdown ilike v_pattern or t.name ilike v_pattern)
    order by n.created_at desc
    limit least(greatest(p_limit,1),100)
  ) matched;
  return v_result;
end;
$$;

create or replace function public.mcp_get_note(p_token text, p_note_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_owner uuid;
begin
  select user_id into v_owner from public.notes where id = p_note_id and deleted_at is null;
  if v_owner is null or v_owner <> v_user_id then
    raise exception 'note_not_found' using errcode = 'P0002';
  end if;
  return public.mcp_note_json(p_note_id);
end;
$$;

create or replace function public.mcp_create_note(
  p_token text,
  p_title text default '',
  p_content_markdown text default '',
  p_source_url text default null,
  p_source_type text default 'agent',
  p_tags text[] default array[]::text[]
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_note_id uuid;
  v_tag text;
  v_tag_id uuid;
begin
  insert into public.notes (user_id, title, content_markdown, source_url, source_type)
  values (v_user_id, coalesce(p_title,''), coalesce(p_content_markdown,''), p_source_url, coalesce(p_source_type,'agent'))
  returning id into v_note_id;

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

create or replace function public.mcp_update_note(
  p_token text,
  p_note_id uuid,
  p_title text default null,
  p_content_markdown text default null,
  p_source_url text default null,
  p_pinned boolean default null,
  p_archived boolean default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_owner uuid;
begin
  select user_id into v_owner from public.notes where id = p_note_id and deleted_at is null;
  if v_owner is null or v_owner <> v_user_id then
    raise exception 'note_not_found' using errcode = 'P0002';
  end if;

  update public.notes set
    title = coalesce(p_title, title),
    content_markdown = coalesce(p_content_markdown, content_markdown),
    source_url = coalesce(p_source_url, source_url),
    pinned = coalesce(p_pinned, pinned),
    archived = coalesce(p_archived, archived)
  where id = p_note_id;

  return public.mcp_note_json(p_note_id);
end;
$$;

create or replace function public.mcp_append_to_note(p_token text, p_note_id uuid, p_content_markdown text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_owner uuid;
  v_current text;
begin
  select user_id, content_markdown into v_owner, v_current from public.notes where id = p_note_id and deleted_at is null;
  if v_owner is null or v_owner <> v_user_id then
    raise exception 'note_not_found' using errcode = 'P0002';
  end if;

  update public.notes
  set content_markdown = case
    when length(trim(coalesce(v_current, ''))) = 0 then p_content_markdown
    else v_current || E'\n\n' || p_content_markdown
  end
  where id = p_note_id;

  return public.mcp_note_json(p_note_id);
end;
$$;

create or replace function public.mcp_tag_note(p_token text, p_note_id uuid, p_tags text[])
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := public.mcp_resolve_user(p_token);
  v_owner uuid;
  v_tag text;
  v_tag_id uuid;
begin
  select user_id into v_owner from public.notes where id = p_note_id and deleted_at is null;
  if v_owner is null or v_owner <> v_user_id then
    raise exception 'note_not_found' using errcode = 'P0002';
  end if;

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
;
