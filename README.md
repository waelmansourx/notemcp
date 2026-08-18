# NoteMCP

Capture without deciding. A mobile-first notes app built for people working alongside AI/coding agents — fast, low-friction capture now, organization later (manually, or eventually via MCP-connected agents).

This is the one-night validation build: Supabase auth + persistence, a chronological note river, an installable PWA, and an Android Web Share Target capture screen.

## Stack

- SvelteKit (Svelte 5, runes) + Tailwind v4
- Supabase (Postgres + Auth, magic-link email sign-in)
- `@vite-pwa/sveltekit` for the installable PWA + Android Web Share Target
- `marked` + `highlight.js` for the markdown editor/preview
- `adapter-node`, deployable via the included `Dockerfile` (Coolify-ready)

## Setup

A Supabase project has already been provisioned and `.env` is populated for local dev. If you need to point at a different project, copy `.env.example` to `.env` and fill in:

```
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
```

Install deps and run:

```bash
bun install
bun run dev
```

The schema (`notes`, `tags`, `note_tags`, all RLS-scoped to `auth.uid()`) is already applied to the Supabase project via migration — see the Supabase dashboard for the project named `notemcp`.