-- The capture flow queues a note in localStorage, POSTs it, and navigates
-- away immediately. If the navigation wins the race the client never sees the
-- response, so the outbox entry is never cleared and flushOutbox() re-POSTs it
-- on the next app open -- which is why every shared link ended up saved twice.
-- Carrying the client-generated id through to the database makes the insert
-- idempotent, so a retry resolves to the row that already exists.
alter table public.notes add column if not exists client_id uuid;

create unique index if not exists notes_user_client_id_key
  on public.notes (user_id, client_id)
  where client_id is not null;
