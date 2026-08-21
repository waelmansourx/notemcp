-- A voice thought keeps the original R2 object as its source of truth. The
-- transcript is enrichment: it can fail or arrive after the user has already
-- edited the note without putting the recording at risk.
create table public.voice_notes (
  note_id uuid primary key references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id uuid not null unique references public.media(id) on delete restrict,
  duration_ms integer not null check (duration_ms >= 0 and duration_ms <= 86400000),
  waveform smallint[] not null default array[]::smallint[],
  transcription_status text not null default 'pending'
    check (transcription_status in ('pending', 'processing', 'complete', 'failed')),
  transcription_provider text not null default 'assemblyai'
    check (transcription_provider = 'assemblyai'),
  provider_transcript_id text unique,
  raw_text text,
  error text,
  language_code text,
  -- The callback only copies raw_text into notes.content_markdown while this
  -- still equals notes.updated_at. A user edit advances updated_at and wins.
  note_updated_at_at_capture timestamptz not null,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_notes_waveform_size check (cardinality(waveform) <= 64)
);

create index voice_notes_user_id_idx on public.voice_notes (user_id);

create trigger voice_notes_set_updated_at
before update on public.voice_notes
for each row execute function public.set_updated_at();

alter table public.voice_notes enable row level security;

create policy "voice_notes_select_own"
on public.voice_notes for select
to authenticated
using ((select auth.uid()) = user_id);

-- Creation happens through the authenticated note API. Both referenced rows
-- must belong to the caller, and the media row must actually be audio.
create policy "voice_notes_insert_own"
on public.voice_notes for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.notes n
    where n.id = note_id and n.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.media m
    where m.id = media_id
      and m.user_id = (select auth.uid())
      and m.kind = 'audio'
  )
);

grant select, insert on table public.voice_notes to authenticated;
