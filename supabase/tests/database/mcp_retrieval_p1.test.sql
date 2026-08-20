begin;

select plan(11);

select is(
  public.mcp_source_domain('https://www.Instagram.com/p/example/'),
  'instagram.com',
  'source domains are normalized for deterministic filtering'
);

select is(
  public.mcp_source_domain('not a URL'),
  null::text,
  'invalid stored source URLs have no domain'
);

select ok(
  public.mcp_has_photos('![legacy](data:image/png;base64,AAAA)'),
  'legacy embedded photos are detected'
);

select ok(
  public.mcp_has_photos('![uploaded](/api/media/00000000-0000-0000-0000-000000000001)'),
  'current uploaded photo references are detected'
);

select is(
  public.mcp_has_photos('plain user-authored text'),
  false,
  'plain text is not reported as a photo note'
);

select ok(
  public.mcp_tag_covers('features', 'features'),
  'a tag path covers itself'
);

select ok(
  public.mcp_tag_covers('features', 'features/main'),
  'a broad path covers descendants'
);

select ok(
  public.mcp_tag_covers('features/main', 'features/main/composer'),
  'a nested path covers only its own branch'
);

select is(
  public.mcp_tag_covers('main', 'features/main'),
  false,
  'a trailing segment is not silently treated as a hierarchy prefix'
);

select is(
  public.mcp_tag_covers('feature', 'features/main'),
  false,
  'tag hierarchy matches whole path segments'
);

select is(
  public.mcp_tag_covers('features%', 'features/main'),
  false,
  'SQL wildcard characters in a requested tag stay literal'
);

select * from finish();

rollback;
