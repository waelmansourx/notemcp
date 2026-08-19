# NoteMCP — agent notes

## Toolchain

`node` and `npm` are not on PATH here; the project runs on **bun**
(`~/.bun/bin/bun`). Useful commands:

```
~/.bun/bin/bun test            # unit tests (bun's runner, NOT vitest)
~/.bun/bin/bunx svelte-check   # types + a11y
~/.bun/bin/bunx vite build     # production build
```

The dev server is started through the preview tooling (`.claude/launch.json`,
config name `dev`), never with a raw shell command.

## Test account

Every screen except `/login`, `/register` and the OAuth routes is behind
Supabase auth, so an agent that can't sign in can only verify by building.
Credentials for a throwaway account live in **`.env.test.local`** (gitignored —
do not use `.env.test`, which `.gitignore` deliberately un-ignores and would be
committed):

```
TEST_EMAIL=...
TEST_PASSWORD=...
```

If that file is missing, ask the user for it rather than registering an
account — creating accounts and typing passwords is something the user does,
not the agent. With it present, sign in at `/login` on the dev server before
verifying anything in the browser.

## Database

The schema lives in **`supabase/migrations/`** — tables, RLS, triggers, the
`preview`/`thread_count` computed columns and all the `mcp_*` functions. It was
reconstructed from the live project's migration history, which until then was
the only copy: a rebuild or a branch would have lost it, and none of it was
reviewable in a diff.

Anything schema-shaped goes in a new file there, named
`<UTC timestamp>_<snake_case>.sql`, and is applied with the Supabase MCP
`apply_migration` tool (or `supabase db push` once linked). Never `execute_sql`
for DDL — it changes the database without leaving a migration behind, which is
how the history came to be missing in the first place.

## The MCP surface

`src/routes/mcp/+server.ts` is a thin JSON-RPC shim: every tool is one
`mcp_*` Postgres function, and the bearer token is checked inside it, not in
the route. Two rules the tools are built around, both about an agent's context
window rather than the database:

- **Lists never carry bodies.** A captured photo *is* a multi-megabyte base64
  data URL; one in a `list_recent_notes` reply would blow out the window.
  Lists return `label` + `preview`, `get_note` returns the body, and an
  embedded photo is redacted to `![photo]` even there — which is why
  `update_note` refuses to rewrite the body of a note that has one.
- **Editing is a patch.** `replace_in_note` changes one span; every write
  takes an optional `if_updated_at` so a note edited on the phone mid-compose
  produces a rejected write instead of a silent overwrite.
