-- Uploaded photos and audio recordings, stored as objects in R2 rather than
-- embedded as base64 data URLs in note bodies (see ADR-001). This table is
-- the source of truth for who owns an object and whether the upload it
-- points at actually landed; the object bytes themselves live in R2 under
-- `{user_id}/{id}.{ext}`.
create table public.media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  r2_key text not null unique,
  kind text not null check (kind in ('image', 'audio')),
  mime_type text not null,
  byte_size bigint check (byte_size is null or byte_size > 0),
  -- 'pending' from the moment a presigned PUT URL is issued; flipped to
  -- 'committed' once the client confirms the upload actually completed. A
  -- row stuck at 'pending' means the object may not exist in R2 at all —
  -- see the note in Consequences (ADR-001) about sweeping these.
  status text not null default 'pending' check (status in ('pending', 'committed')),
  created_at timestamptz not null default now()
);

create index media_user_id_idx on public.media (user_id);
create index media_user_status_idx on public.media (user_id, status) where status = 'pending';

alter table public.media enable row level security;

create policy "media_select_own" on public.media for select using (auth.uid() = user_id);
create policy "media_insert_own" on public.media for insert with check (auth.uid() = user_id);
create policy "media_update_own" on public.media for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "media_delete_own" on public.media for delete using (auth.uid() = user_id);
