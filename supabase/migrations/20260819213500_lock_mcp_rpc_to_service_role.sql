-- Make /mcp the only door.
--
-- The mcp_* functions are SECURITY DEFINER and were granted to `anon`, so
-- POST /rest/v1/rpc/mcp_search_notes with the public anon key and a bearer
-- token worked from anywhere — the SvelteKit route was never a chokepoint,
-- and nothing outside Postgres could rate-limit, log, or revoke a caller.
-- Every function does check ownership, so this was not a data leak; it was a
-- missing chokepoint, and an unthrottled surface for guessing tokens.
--
-- DO NOT APPLY THIS UNTIL the deployment has SUPABASE_SERVICE_ROLE_KEY set
-- (Netlify env + local .env). src/routes/mcp/+server.ts falls back to the
-- anon key when that variable is missing, and this migration would break
-- that fallback the moment it lands.

revoke execute on function public.mcp_search_notes(text, text, text[], integer, integer, text, boolean) from public, anon, authenticated;
revoke execute on function public.mcp_list_recent_notes(text, integer, integer, text, text, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.mcp_get_note(text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.mcp_list_tags(text) from public, anon, authenticated;
revoke execute on function public.mcp_create_note(text, text, text, text, text, text[], uuid, uuid) from public, anon, authenticated;
revoke execute on function public.mcp_update_note(text, uuid, text, text, text, boolean, boolean, text[], timestamptz) from public, anon, authenticated;
revoke execute on function public.mcp_append_to_note(text, uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.mcp_replace_in_note(text, uuid, text, text, boolean, timestamptz) from public, anon, authenticated;
revoke execute on function public.mcp_tag_note(text, uuid, text[]) from public, anon, authenticated;
revoke execute on function public.mcp_untag_note(text, uuid, text[]) from public, anon, authenticated;
revoke execute on function public.mcp_delete_note(text, uuid, boolean, timestamptz) from public, anon, authenticated;

grant execute on function public.mcp_search_notes(text, text, text[], integer, integer, text, boolean) to service_role;
grant execute on function public.mcp_list_recent_notes(text, integer, integer, text, text, boolean, boolean) to service_role;
grant execute on function public.mcp_get_note(text, uuid, boolean) to service_role;
grant execute on function public.mcp_list_tags(text) to service_role;
grant execute on function public.mcp_create_note(text, text, text, text, text, text[], uuid, uuid) to service_role;
grant execute on function public.mcp_update_note(text, uuid, text, text, text, boolean, boolean, text[], timestamptz) to service_role;
grant execute on function public.mcp_append_to_note(text, uuid, text, timestamptz) to service_role;
grant execute on function public.mcp_replace_in_note(text, uuid, text, text, boolean, timestamptz) to service_role;
grant execute on function public.mcp_tag_note(text, uuid, text[]) to service_role;
grant execute on function public.mcp_untag_note(text, uuid, text[]) to service_role;
grant execute on function public.mcp_delete_note(text, uuid, boolean, timestamptz) to service_role;
