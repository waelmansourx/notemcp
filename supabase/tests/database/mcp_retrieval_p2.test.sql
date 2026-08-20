begin;

select plan(10);

create temp table p2_fixture (
  user_id uuid,
  note_a uuid,
  note_b uuid,
  media_id uuid,
  token text
) on commit drop;

insert into p2_fixture values (
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000004',
  'notemcp-p2-database-test-token'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', user_id, 'authenticated', 'authenticated',
  'notemcp-p2-test@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from p2_fixture;

insert into public.api_tokens (id, user_id, name, token_hash)
select
  gen_random_uuid(), user_id, 'P2 database test',
  encode(extensions.digest(token, 'sha256'), 'hex')
from p2_fixture;

insert into public.notes (
  id, user_id, title, content_markdown, source_url, source_type,
  source_title, source_description, source_image
)
select
  note_a, user_id, 'Dental scan post', 'Several things looked concerning',
  'https://example.com/xray', 'share', 'Dental scan post',
  'The radiograph showed several possible cavities.',
  'https://images.example.com/xray.jpg'
from p2_fixture
union all
select
  note_b, user_id, 'Garden notes', 'Water the basil on Friday',
  null, 'manual', null, null, null
from p2_fixture;

select ok(
  exists(select 1 from pg_extension where extname = 'vector'),
  'pgvector is installed for semantic retrieval'
);

select like(
  public.mcp_embedding_document(note_a)->>'input',
  '%User text (highest priority):%Several things looked concerning%',
  'embedding input gives authored text the largest field budget'
)
from p2_fixture;

select like(
  public.mcp_embedding_document(note_a)->>'input',
  '%Source context (lower priority):%possible cavities%',
  'lower-weight source context remains semantically discoverable'
)
from p2_fixture;

select ok(
  length(public.mcp_embedding_document(note_a)->>'input') <= 2200,
  'embedding input stays inside the gte-small token budget'
)
from p2_fixture;

select is(
  jsonb_array_length(public.mcp_list_pending_embeddings(token, 200)),
  2,
  'new notes are listed for lazy embedding backfill'
)
from p2_fixture;

select public.mcp_store_note_embedding(
  token,
  note_a,
  public.mcp_embedding_document(note_a)->>'content_hash',
  (array[1.0] || array_fill(0.0, array[383]))::extensions.vector(384)
)
from p2_fixture;

select public.mcp_store_note_embedding(
  token,
  note_b,
  public.mcp_embedding_document(note_b)->>'content_hash',
  (array[0.0, 1.0] || array_fill(0.0, array[382]))::extensions.vector(384)
)
from p2_fixture;

select is(
  jsonb_array_length(public.mcp_list_pending_embeddings(token, 200)),
  0,
  'stored current embeddings leave the lazy queue'
)
from p2_fixture;

select is(
  public.mcp_search_notes_semantic(
    p_token => token,
    p_query_embedding => (array[1.0] || array_fill(0.0, array[383]))::extensions.vector(384),
    p_limit => 2
  )->0->>'id',
  note_a::text,
  'semantic retrieval ranks the closest normalized vector first'
)
from p2_fixture;

select is(
  public.mcp_get_note_asset_descriptor(token, note_a, 'source', 0)->>'url',
  'https://images.example.com/xray.jpg',
  'source assets are resolved from the owned note rather than caller URLs'
)
from p2_fixture;

insert into public.media (id, user_id, r2_key, kind, mime_type, byte_size, status)
select media_id, user_id, user_id::text || '/' || media_id::text || '.jpg',
  'image', 'image/jpeg', 1000, 'committed'
from p2_fixture;

update public.notes n
set content_markdown = n.content_markdown || E'\n\n![](/api/media/' || f.media_id::text || ')'
from p2_fixture f
where n.id = f.note_a;

select is(
  public.mcp_get_note_asset_descriptor(token, note_a, 'body', 0)->>'r2_key',
  user_id::text || '/' || media_id::text || '.jpg',
  'body assets resolve only through media owned by the note owner'
)
from p2_fixture;

select ok(
  not has_schema_privilege('anon', 'private', 'usage')
  and not has_table_privilege('anon', 'private.mcp_note_embeddings', 'select')
  and not has_function_privilege(
    'anon',
    'public.mcp_search_notes_semantic(text,extensions.vector,text[],integer,integer,text,boolean,text,text,boolean,boolean,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid)',
    'execute'
  ),
  'semantic storage and RPCs are not exposed to anon'
);

select * from finish();

rollback;
