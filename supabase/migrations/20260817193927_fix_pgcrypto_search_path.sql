
create or replace function public.mcp_resolve_user(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
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

revoke execute on function public.mcp_resolve_user(text) from public, anon, authenticated;
;
