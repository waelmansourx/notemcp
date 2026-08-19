
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  content_markdown text not null default '',
  source_url text,
  source_type text,
  folder_id uuid,
  pinned boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index notes_user_id_idx on public.notes (user_id);
create index notes_user_created_idx on public.notes (user_id, created_at desc);
create index notes_user_pinned_idx on public.notes (user_id, pinned) where pinned = true;
create index notes_user_active_idx on public.notes (user_id) where deleted_at is null and archived = false;

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.note_tags (
  note_id uuid not null references public.notes(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (note_id, tag_id)
);

create index note_tags_tag_id_idx on public.note_tags (tag_id);

alter table public.notes enable row level security;
alter table public.tags enable row level security;
alter table public.note_tags enable row level security;

create policy "notes_select_own" on public.notes for select using (auth.uid() = user_id);
create policy "notes_insert_own" on public.notes for insert with check (auth.uid() = user_id);
create policy "notes_update_own" on public.notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notes_delete_own" on public.notes for delete using (auth.uid() = user_id);

create policy "tags_select_own" on public.tags for select using (auth.uid() = user_id);
create policy "tags_insert_own" on public.tags for insert with check (auth.uid() = user_id);
create policy "tags_update_own" on public.tags for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tags_delete_own" on public.tags for delete using (auth.uid() = user_id);

create policy "note_tags_select_own" on public.note_tags for select using (
  exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
);
create policy "note_tags_insert_own" on public.note_tags for insert with check (
  exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
  and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = auth.uid())
);
create policy "note_tags_delete_own" on public.note_tags for delete using (
  exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger notes_set_updated_at
before update on public.notes
for each row execute function public.set_updated_at();
;
