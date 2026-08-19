-- A thought that continues an earlier one points at it. Reusing `notes` for
-- both ends means a continuation carries tags, links, images and the whole
-- capture pipeline for free — it is a note, it just isn't the first one.
alter table public.notes
	add column if not exists parent_id uuid references public.notes(id) on delete cascade;

create index if not exists notes_parent_idx on public.notes (user_id, parent_id);

-- Threads are flat on purpose. A continuation can't itself be continued:
-- pointing at one resolves to the note it belongs to, so a thread is always
-- one note and its thoughts, never a tree you have to navigate.
create or replace function public.notes_flatten_parent()
returns trigger language plpgsql as $$
begin
	if new.parent_id is not null then
		select coalesce(p.parent_id, p.id) into new.parent_id
		from public.notes p
		where p.id = new.parent_id;

		if new.parent_id = new.id then
			new.parent_id := null;
		end if;
	end if;
	return new;
end $$;

drop trigger if exists notes_flatten_parent on public.notes;
create trigger notes_flatten_parent
	before insert or update of parent_id on public.notes
	for each row execute function public.notes_flatten_parent();

-- Adding to a thread is activity on the thread: the stream orders by
-- updated_at, so this is what brings the whole thing back to Today.
create or replace function public.notes_touch_parent()
returns trigger language plpgsql as $$
begin
	if new.parent_id is not null then
		update public.notes set updated_at = now() where id = new.parent_id;
	end if;
	return new;
end $$;

drop trigger if exists notes_touch_parent on public.notes;
create trigger notes_touch_parent
	after insert on public.notes
	for each row execute function public.notes_touch_parent();
