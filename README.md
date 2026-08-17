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

## The core loop (what to validate)

1. Deploy somewhere reachable over HTTPS from your phone (Coolify using the included `Dockerfile`, or any other host — Android's Web Share Target and PWA installability both require HTTPS and won't work against plain `localhost` from a phone). For a quick one-off check without deploying, a tunnel like `cloudflared tunnel --url http://localhost:5173` (against `bun run preview` after `bun run build`, not `dev`, since the service worker is disabled in dev) works too.
2. On Android Chrome, open the deployed URL, sign in via the magic-link email, then **Add to Home screen**.
3. Open Instagram (or any app) → Share → **NoteMCP**.
4. You should land on the capture screen with a minimal preview of the shared item, an optional caption field, five quick-tag squares, an **Open** square, and a prominent **Just save** button.
5. Tap `#inspo` (or any quick tag) — it should save instantly with no further confirmation, and show a `Saved · Undo` toast.
6. Open NoteMCP on the Mac (same account) and confirm the note appears in the river with the correct tag, caption, and source link.

If that loop feels fast and calm end-to-end, the validation condition is met.

## Deploying to Coolify

Build the image with the two `PUBLIC_*` build args (they're inlined into the client bundle at build time):

```bash
docker build \
  --build-arg PUBLIC_SUPABASE_URL=... \
  --build-arg PUBLIC_SUPABASE_ANON_KEY=... \
  -t notemcp .
```

`adapter-node` needs to know its own origin to validate non-GET requests behind a reverse proxy — set `ORIGIN` (e.g. `https://notes.yourdomain.com`) as a runtime env var on the container.

## Deliberately out of scope tonight

MCP server, AI features, attachment storage (R2), browser extension, backlinks, folders/graph views, kanban, collaboration, CRDTs, advanced offline sync, plugin systems. See the product brief for the long-term MCP tool surface (`search_notes`, `create_note`, etc.) — none of that is wired up yet.
