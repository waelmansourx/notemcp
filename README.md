# NoteMCP

Capture without deciding. A mobile-first notes app built for people working alongside AI/coding agents — fast, low-friction capture now, organization later (manually, or eventually via MCP-connected agents).

This is the one-night validation build: Supabase auth + persistence, a chronological note river, an installable PWA, and an Android Web Share Target capture screen.

## Threads

A second thought about something you already wrote doesn't need a new note, and
shouldn't cost a trip to go and find the old one. So notes thread: a
continuation is an ordinary note carrying `parent_id`, and a thread is
assembled at read time (`src/lib/thread.ts`).

You never create a thread — one exists the moment you add to a note twice. The
composer offers the threads you might be writing into (`Continue` strip),
stays attached to the last one for 30 minutes the way a chat window stays open
(`src/lib/composer.svelte.ts`), and every row in the stream carries a `+` that
attaches the composer without opening the note. Threads are flat, enforced by a
database trigger: pointing at a continuation resolves to the note it belongs
to.

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
