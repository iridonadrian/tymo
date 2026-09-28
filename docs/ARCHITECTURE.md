# Architecture

Tymo is deliberately small: **one Next.js process, one SQLite file, one data directory.**
No microservices, no queue server, no search cluster. Everything below can be understood
in an afternoon.

```
┌──────────────────────┐        HTTPS/HTTP + Bearer token        ┌──────────────────────────┐
│  Browser extension   │ ──────────────────────────────────────▶ │  apps/web (Next.js)      │
│  (Chromium, Firefox) │   /api/v1/*  (JSON, versioned)          │                          │
└──────────────────────┘                                         │  UI: React Server Comps  │
                                                                 │  + Server Actions        │
┌──────────────────────┐   same-origin Server Actions            │                          │
│  Web UI (browser)    │ ──────────────────────────────────────▶ │  server/  (db, search,   │
└──────────────────────┘                                         │   fetcher, files, ai)    │
                                                                 └────────────┬─────────────┘
                                                                              │
                                                  ┌───────────────────────────┼──────────────┐
                                                  ▼                           ▼              ▼
                                           SQLite (libSQL)             DATA_DIR/files   Optional AI
                                           + FTS5 index                (uploads,        provider
                                                                        screenshots)    (Ollama/OpenAI/
                                                                                         Anthropic/Gemini)
```

## Repository layout

```
apps/
  web/          Next.js app: UI, server actions, REST API for the extension, DB access
  extension/    WebExtension (MV3) for Chromium + Firefox, built with esbuild
packages/
  core/         Pure, framework-free TypeScript: validation schemas, URL safety,
                content-type detection, HTML metadata parsing, bookmark import/export,
                search-query parsing, smart-collection rules. Fully unit-tested.
docs/           Spec, architecture, threat model
```

`packages/core` has no I/O. Anything that touches the network, disk or database lives in
`apps/web/src/server`. That boundary keeps the security-sensitive parsing code testable.

## Key decisions

| Decision                                               | Why                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Next.js App Router, Server Components + Server Actions | One deployable. Server Actions give same-origin CSRF protection for the UI for free.                                                                                                                                                                                     |
| Separate `/api/v1` REST routes for the extension       | Stable, versioned contract; bearer-token auth (never cookies) so it is CSRF-immune.                                                                                                                                                                                      |
| SQLite via libSQL + Drizzle ORM                        | Zero-ops, single file, fast to 100k+ rows, ships FTS5. libSQL has prebuilt binaries (no node-gyp).                                                                                                                                                                       |
| SQLite FTS5 for search                                 | Sub-10ms full-text search with BM25 ranking and prefix matching at 100k rows.                                                                                                                                                                                            |
| PostgreSQL **deferred**                                | The spec allows Postgres for self-hosting. SQLite in a Docker volume already serves a single user well; supporting two SQL dialects doubles migration and test cost. All SQL lives in `server/` (Drizzle + one FTS module), so a Postgres adapter is a contained change. |
| Single user, no accounts                               | Local-first. Self-hosters set `TYMO_PASSWORD` to put a login gate in front of everything.                                                                                                                                                                                |
| Metadata fetched **after** saving (`after()`)          | Save returns instantly; enrichment happens in the background.                                                                                                                                                                                                            |
| No UI kit dependency                                   | A handful of hand-rolled primitives on Tailwind v4 keep the bundle and the surface small.                                                                                                                                                                                |

## Data model

All IDs are random UUIDv7-style strings generated server-side. Timestamps are Unix ms.

```
saves
  id PK, type, status('inbox'|'active'), url, normalized_url (dup detection),
  title, description, domain, favicon_url, image_url, notes, body (note/snippet text),
  extracted_text, ai_summary, is_favorite, is_archived, capture_method, source,
  metadata JSON (type-specific: place/book/movie/recipe/tool…), metadata_status,
  created_at, updated_at, last_opened_at, open_count

collections
  id PK, name, icon, description, cover_url, parent_id → collections (nesting),
  smart_rules JSON (null = manual collection), position, created_at, updated_at

save_collections   (save_id, collection_id) PK     — manual membership only
tags               id PK, name UNIQUE (lowercase slug)
save_tags          (save_id, tag_id) PK

sessions           id PK, name, notes, browser, tab_count, created_at
session_items      id PK, session_id, save_id, position, window_index,
                   group_title, group_color, pinned, title/url snapshot

embeddings         save_id PK → saves, model, dims, vector BLOB (Float32, L2-normalized),
                   content_hash, updated_at            — optional, semantic search only

files              id PK, save_id, kind('upload'|'screenshot'|'snapshot'), mime,
                   size, sha256, storage_key, created_at
api_tokens         id PK, name, token_hash (SHA-256), prefix, created_at, last_used_at
settings           key PK, value JSON

saves_fts          FTS5(save_id UNINDEXED, title, description, url, tags, notes, body)
```

Specialized content (places, books, recipes, …) lives in `saves.metadata` validated by
per-type Zod schemas in `packages/core`, so new types need no migration.

Smart collections never store membership: their `smart_rules` compile to a SQL `WHERE`
clause at query time, so new matching Saves appear automatically.

Migrations are generated by `drizzle-kit` into `apps/web/drizzle/` and applied on boot.

## Search

Query string → `parseQuery()` (core) → `{ text, filters }`.

Supported operators: `tag:osint`, `#osint`, `domain:github.com`, `type:repo`, `in:inbox`,
`is:fav`, `is:archived`, `collection:"AI Tools"`, `before:2026-01-01`, `after:2026-01-01`,
and `-term` to exclude. Free text becomes an FTS5 `MATCH` with prefix matching on each
token, ranked by `bm25()` with field weights (title 10, tags 6, description 4, url 3,
notes 3, body 1). Filters compile into the same SQL statement, and results are paginated
with `LIMIT/OFFSET` (60 per page), so the browser never holds the whole library.

### Semantic search (optional)

When **Settings → AI → Semantic search** is on, every save gets an embedding
(`server/embeddings.ts`): title, description, summary, tags, domain, notes and the first
2,500 characters of text. `reindexSave()` queues a save whenever searchable fields change;
a debounced background worker embeds in batches of 32 and skips text whose
`content_hash` is unchanged. Vectors are kept in memory and searched by brute-force cosine
similarity (fast enough for tens of thousands of saves; no vector extension required).

For free-text queries sorted by relevance, keyword (BM25) and semantic hits are fused with
Reciprocal Rank Fusion; both honour the same filters. Results that matched only by meaning
are marked "≈ similar" in the UI. If the embeddings provider is down or nothing is indexed
yet, search silently falls back to FTS alone. The same vectors power **Related** in the save
detail panel (keyword fallback without AI) and near-duplicate detection.

Embeddings use the provider's API: OpenAI-compatible `/embeddings` (OpenAI, Ollama,
LM Studio…) or Gemini `batchEmbedContents`. Anthropic has no embeddings API, so it needs an
OpenAI-compatible embeddings URL. The chat API key is only sent to the chat provider's own
endpoint. Changing the model deletes old vectors and re-indexes.

### Page archiving

"Archive page" (or **Settings → Page archiving → automatic**) stores an offline copy of a
save as `files.kind = 'snapshot'`. `server/archive.ts` fetches the page with `safeFetch`,
inlines up to 12 stylesheets and 80 images (through the image proxy), and
`rewriteForArchive()` in core strips everything executable. The result is one HTML file
served sandboxed from `/files/:id`. Re-archiving replaces the previous copy.

### Duplicates

Exact duplicates never happen: saving a URL whose normalized form already exists merges
into the existing save. The **Duplicates** page (`server/duplicates.ts`) finds the rest:
different URLs that redirect to the same final page, identical normalized titles (≥ 16
chars), and — with semantic search on — near-identical embeddings (cosine ≥ 0.95, found
with random-hyperplane LSH instead of comparing every pair). "Keep this one" merges tags,
manual collections, notes, files and session history into the kept save
(`mergeSaves()`); "Not duplicates" is remembered in settings.

## API boundaries

**Web UI → server**: Server Actions in `apps/web/src/server/actions/*`. Every action
validates input with Zod.

**Extension → server** (`/api/v1`, `Authorization: Bearer tymo_…`):

| Method | Path                        | Purpose                                              |
| ------ | --------------------------- | ---------------------------------------------------- |
| GET    | `/api/v1/ping`              | Verify URL + token, returns app version              |
| GET    | `/api/v1/collections`       | Collections for the picker                           |
| GET    | `/api/v1/tags`              | Tag suggestions                                      |
| GET    | `/api/v1/saves`             | Search / list saves (same query language as the UI)  |
| GET    | `/api/v1/saves/:id`         | One save with its full stored text                   |
| PATCH  | `/api/v1/saves/:id`         | Update fields, tags, collections, status             |
| DELETE | `/api/v1/saves/:id`         | Delete a save                                        |
| GET    | `/api/v1/saves/:id/related` | Related saves                                        |
| POST   | `/api/v1/saves/:id/archive` | Archive the page                                     |
| POST   | `/api/v1/saves`             | Create a Save (url / note / snippet / image URL)     |
| POST   | `/api/v1/saves/screenshot`  | Create a screenshot Save (PNG/JPEG data URL, ≤ 8 MB) |
| POST   | `/api/v1/sessions`          | Create a Session from a list of tabs                 |
| GET    | `/api/v1/sessions`          | Recent sessions (for restore)                        |
| GET    | `/api/v1/sessions/:id`      | Session items in tab order                           |
| POST   | `/api/v1/sessions/:id`      | Report that the session was restored                 |

`GET /api/health` is unauthenticated (used by Docker healthchecks).

**Files**: `GET /files/:id` streams an uploaded file with a fixed `Content-Type`,
`X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. Archived pages
(`kind = 'snapshot'`) get a stricter CSP with no network access at all.

**Images**: `GET /img?u=<url>` is the privacy proxy for favicons and preview images
(`server/images.ts`). The browser never loads third-party images directly; CSP
`img-src` is `'self' data: blob:`.

**Export**: `GET /export?format=json|csv|html|md`.

**Backup**: `GET /backup` streams a `.tar.gz` (manifest, a `VACUUM INTO` snapshot of the
database, every stored file); `POST /backup` restores one (same-origin only), swapping the
data in with the database closed (`withDatabaseClosed()` in `server/db`).

## Browser-extension communication model

1. The user creates an API token in **Settings → Browser extension**. Only its SHA-256
   hash is stored; the plaintext is shown once.
2. In the extension options page the user enters the server URL and token. The extension
   requests host permission **only for that origin** (`optional_host_permissions`).
3. All calls go from the extension's background/popup context to `/api/v1/*` with the
   bearer token. The extension never injects content scripts into pages.
4. Permissions: `activeTab`, `tabs` (needed to read URLs/titles for sessions), `storage`,
   `contextMenus`, and `tabGroups` on Chromium. No `<all_urls>`, no `scripting`.
5. Screenshots use `tabs.captureVisibleTab`, which `activeTab` permits after a user
   gesture (click, shortcut, context menu).
6. Session restore happens inside the extension (it can create windows, tabs, and tab
   groups); the web UI offers "copy all URLs" and per-item open as a fallback.

Safari: the extension only uses standard `browser.*`/`chrome.*` WebExtension APIs and no
Chromium-only features without feature detection, so it can be wrapped with
`xcrun safari-web-extension-converter` later.

## Metadata extraction

`server/fetcher.ts` → `safeFetch()` → `packages/core/html-metadata.ts`.
See `THREAT_MODEL.md` for the SSRF controls. We read at most 1.5 MB of `text/html`,
parse it with `htmlparser2` (a tokenizer, never a DOM that executes anything), and pull
Open Graph / Twitter / `<title>` / description / icon / canonical / JSON-LD type plus up
to 20 kB of visible text for search.

## AI (optional)

`server/ai.ts` speaks three wire formats with plain `fetch`: OpenAI-compatible (OpenAI,
Ollama, LM Studio, OpenRouter, …), Anthropic Messages, and Gemini. Configured in
Settings, disabled by default. It suggests title, description, tags, a collection and a
summary. Suggestions are shown for review; nothing is applied without a click.

**Text in images (OCR)** is opt-in: with "Extract text from new screenshots and images" on,
new uploads and extension screenshots are sent (one at a time, ≤ 5 MB) to the provider's
vision model (`server/ocr.ts`), and the transcription is stored in `saves.extracted_text`,
which full-text and semantic search already index. A local vision model (e.g. Ollama with
`llava` or `llama3.2-vision`) keeps images on your machine. PDFs are not parsed.

## Design tokens

Defined once as CSS custom properties in `apps/web/src/app/globals.css` (`@theme`). The dark
palette follows Linear's "midnight precision instrument" style: layered near-black surfaces,
hairline borders instead of shadows, a white → mist → fog grey text scale, and one accent.

| Token                   | Dark value                                                    | Use                               |
| ----------------------- | ------------------------------------------------------------- | --------------------------------- |
| `--color-bg`            | `#08090a` (void)                                              | App background                    |
| `--color-surface`       | `#0f1011` (carbon)                                            | Cards, sidebar                    |
| `--color-surface-2`     | `#161718` (obsidian)                                          | Hover, inputs, popovers           |
| `--color-surface-3`     | `#23252a` (slate)                                             | Pressed / strongest surface       |
| `--color-border`        | `#23252a` (graphite)                                          | Hairline borders                  |
| `--color-border-strong` | `#383b3f` (smoke)                                             | Hover borders, dividers           |
| `--color-accent`        | `#6798ff`                                                     | Primary action, focus, code field |
| `--color-fg`            | `#f7f8f8`                                                     | Primary text                      |
| `--color-fg-2`          | `#b4bac4`                                                     | Secondary text                    |
| `--color-muted`         | `#8a8f98` (fog)                                               | Metadata, placeholders            |
| `--shadow-elevated`     | inset highlight + dark ring + drop                            | Dialogs, palette, menus, toasts   |
| `--shadow-button`       | layered inset stack                                           | Primary button only               |
| `--font-sans`           | Inter, `cv01` `ss03` `zero`                                   | UI; weights 400 / 510 / 590 only  |
| `--font-mono`           | JetBrains Mono                                                | Eyebrows, metadata, counts, kbd   |
| radius                  | 6px controls (`rounded-lg`), 12px cards (`rounded-xl`), pills |                                   |
| tracking                | `-0.022em` headings (`tracking-tight`)                        |                                   |

`font-medium` is 510 and `font-semibold` 590 (never bold); headings use `tracking-tight`.
Layout follows Linear's app: the sidebar sits directly on the canvas and all page content lives
in one inset, rounded, hairline-bordered panel (`bg-panel`); cards inside it are one step lighter.
No coloured bands or light pools: the accent is only for actions, and the code field's lit glyphs
use `--color-glow`. `.card` is the framed surface (hairline border + top-edge highlight).
The accent is user-selectable (Settings → Appearance: presets or any colour). The choice is a
`tymo_accent` cookie; the root layout renders `<style id="tymo-accent">` from `lib/accent.ts`,
which derives every accent token for both themes from one validated hex: `accent` (fills),
`on-accent` (black or white by contrast), `accent-soft`, and `accent-ink` for accent-coloured
text, darkened until it reaches 4.5:1 on the background, so a bright fill like lime stays lime.

The light theme redefines the same tokens under `:root[data-theme="light"]` (and under
`prefers-color-scheme: light` when no theme is chosen). Extra tokens cover what used to be
hardcoded: `accent-hover`, `on-accent`, `danger-soft`, `danger-soft-hover`, `danger-line`,
`grid-line`. The choice is a `tymo_theme` cookie that the root layout reads, so the server
renders the right theme with no flash and no inline script. Components must not hardcode
colours.

Fonts are self-hosted at build time by `next/font` — no runtime Google requests.
The dashboard hero, every `PageHeader` and the login screen use `CodeField`
(`components/code-field.tsx`): a canvas of faint monospace glyphs that shimmer slowly and light
up around the pointer, blending continuously from `--color-fg-2` to `--color-accent`. Each cell
has a jittered radius so the glow has an organic edge, and `.code-field-mask` fades the left,
right and bottom edges; headers end in a fading hairline (`HeaderRule`) rather than a border.
Performance: glyphs are pre-rendered into an atlas per theme and blitted with `drawImage` +
`globalAlpha`; it runs at 30 fps only while the pointer is near (12 fps idle), pauses off-screen
and in background tabs, and draws one static frame under `prefers-reduced-motion`.
Empty states keep the subtle 24px blueprint grid (`.bg-blueprint`).

## Extension points (future, not built)

| Future feature         | Where it plugs in                                                               |
| ---------------------- | ------------------------------------------------------------------------------- |
| PostgreSQL             | Drizzle `pg-core` schema mirror + `tsvector` search module in `server/search`   |
| Multi-user / sharing   | Add `users`, `user_id` columns; auth gate already centralised in middleware     |
| Bots / Raycast / email | Reuse `/api/v1` + API tokens (full reference: `docs/API.md`; MCP in `apps/mcp`) |
| Safari / native apps   | Same `/api/v1` contract                                                         |
