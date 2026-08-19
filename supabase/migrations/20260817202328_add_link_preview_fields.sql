
alter table public.notes
  add column source_title text,
  add column source_description text,
  add column source_image text;

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
    'source_title', n.source_title,
    'source_description', n.source_description,
    'source_image', n.source_image,
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

revoke execute on function public.mcp_note_json(uuid) from public, anon, authenticated;

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
;
