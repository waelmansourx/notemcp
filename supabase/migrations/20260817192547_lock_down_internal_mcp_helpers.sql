
revoke execute on function public.mcp_resolve_user(text) from public, anon, authenticated;
revoke execute on function public.mcp_note_json(uuid) from public, anon, authenticated;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;
;
