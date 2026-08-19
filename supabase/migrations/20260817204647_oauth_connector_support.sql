
-- OAuth 2.1 (auth code + PKCE) support so remote MCP clients (e.g. claude.ai
-- connectors) can authorize themselves and receive a normal api_tokens PAT,
-- without needing password-manager-style credential sharing.

create table public.oauth_clients (
  client_id text primary key,
  client_name text not null default 'MCP client',
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

create table public.oauth_codes (
  code text primary key,
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  used boolean not null default false,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  created_at timestamptz not null default now()
);

alter table public.oauth_clients enable row level security;
alter table public.oauth_codes enable row level security;
-- No policies: all access goes through the SECURITY DEFINER functions below,
-- same pattern as the mcp_* functions gating public.notes/api_tokens.

create or replace function public.oauth_register_client(p_client_name text, p_redirect_uris text[])
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_client_id text;
begin
  if p_redirect_uris is null or array_length(p_redirect_uris, 1) is null then
    raise exception 'invalid_redirect_uri' using errcode = '22023';
  end if;

  v_client_id := 'nmcp_client_' || regexp_replace(translate(encode(gen_random_bytes(16), 'base64'), '+/', '-_'), '=+$', '');

  insert into public.oauth_clients (client_id, client_name, redirect_uris)
  values (v_client_id, coalesce(nullif(trim(p_client_name), ''), 'MCP client'), p_redirect_uris);

  return v_client_id;
end;
$$;

create or replace function public.oauth_get_client(p_client_id text)
returns table(client_name text, redirect_uris text[])
language sql
security definer
set search_path to 'public'
as $$
  select client_name, redirect_uris from public.oauth_clients where client_id = p_client_id;
$$;

create or replace function public.oauth_create_code(
  p_client_id text,
  p_redirect_uri text,
  p_code_challenge text,
  p_code_challenge_method text
) returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_user_id uuid := auth.uid();
  v_redirect_uris text[];
  v_code text;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select redirect_uris into v_redirect_uris from public.oauth_clients where client_id = p_client_id;
  if v_redirect_uris is null or not (p_redirect_uri = any(v_redirect_uris)) then
    raise exception 'invalid_client' using errcode = '22023';
  end if;

  if coalesce(p_code_challenge_method, '') <> 'S256' or coalesce(p_code_challenge, '') = '' then
    raise exception 'unsupported_code_challenge_method' using errcode = '22023';
  end if;

  v_code := encode(gen_random_bytes(32), 'hex');

  insert into public.oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method)
  values (v_code, p_client_id, v_user_id, p_redirect_uri, p_code_challenge, p_code_challenge_method);

  return v_code;
end;
$$;

create or replace function public.oauth_exchange_code(
  p_code text,
  p_client_id text,
  p_redirect_uri text,
  p_code_verifier text
) returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_row public.oauth_codes%rowtype;
  v_computed text;
  v_raw bytea;
  v_token text;
  v_hash text;
begin
  select * into v_row from public.oauth_codes
    where code = p_code and client_id = p_client_id and redirect_uri = p_redirect_uri
    for update;

  if v_row.code is null or v_row.used or v_row.expires_at < now() then
    raise exception 'invalid_grant' using errcode = '28000';
  end if;

  v_computed := regexp_replace(translate(encode(digest(coalesce(p_code_verifier, ''), 'sha256'), 'base64'), '+/', '-_'), '=+$', '');
  if v_computed <> v_row.code_challenge then
    raise exception 'invalid_grant' using errcode = '28000';
  end if;

  update public.oauth_codes set used = true where code = p_code;

  v_raw := gen_random_bytes(24);
  v_token := 'nmcp_' || regexp_replace(translate(encode(v_raw, 'base64'), '+/', '-_'), '=+$', '');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  insert into public.api_tokens (user_id, name, token_hash)
  values (v_row.user_id, 'Claude', v_hash);

  return v_token;
end;
$$;
;
