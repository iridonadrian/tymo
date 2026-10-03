# Handoff — state of Tymo (2026-09-26)

Start here in a new chat. Also read `CLAUDE.md`, `docs/PROJECT_SPEC.md`, `docs/ARCHITECTURE.md`.

## Where things are

- `main` holds everything below (milestones 1–7 plus later additions).
- Checks on `main`: lint, typecheck, format, Vitest, build, Playwright e2e — all green.
- Local setup: `npm install && npm run dev` → http://127.0.0.1:3210 (data in `apps/web/data/`).
  README screenshots: `npm run demo:seed` + `npm run demo:screenshots` (`apps/web/scripts/demo`, offline, fictional data).
  Demo data from real sites: create a token (`node apps/web/scripts/create-token.mjs`), then `TYMO_TOKEN=… npm run seed -w @tymo/web`.

## Milestone 7

| Feature         | Where                                                                                                    | Notes                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Image proxy     | `server/images.ts`, `app/img/route.ts`, `lib/format.ts → imageSrc()`                                     | CSP `img-src` is now `'self' data: blob:`; disk cache in `DATA_DIR/cache/img` |
| Semantic search | `server/embeddings.ts`, `server/ai.ts → embed()`, migration `0002`                                       | Off by default; hybrid RRF in `saves.ts → hybridList()`; "≈ SIMILAR" badge    |
| Related saves   | `saves.ts → relatedSaves()`, detail sheet                                                                | Vector neighbours, or keyword fallback without AI                             |
| Duplicates      | `server/duplicates.ts`, `/duplicates`, `saves.ts → mergeSaves()`                                         | Same final URL / same title / cosine ≥ 0.95 (LSH); dismissals in settings     |
| Page archiving  | `core/archive.ts` (rewrite), `server/archive.ts`, `/files/:id` CSP                                       | Manual button or Settings → auto; `files.kind = 'snapshot'`                   |
| OCR             | `server/ocr.ts`, `ai.ts → complete(..., image)`                                                          | Opt-in; vision model of the configured provider; fills `extracted_text`       |
| Fixes           | `settings.ts` (empty env vars no longer override UI), `npm run seed`, image fallbacks, React key warning |                                                                               |

Later additions:

| Feature                  | Where                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REST API for saves       | `app/api/v1/saves/**` (search, get with text, PATCH, DELETE, related, archive); `docs/API.md`                                                                                                                                                                            |
| MCP server               | `apps/mcp` (stdio, one bundled file); tools in `src/tools.ts`, tested via in-memory client                                                                                                                                                                               |
| Installable app + share  | `app/manifest.ts`, `app/(app)/share`, `components/share-handler.tsx`, PNG icons in `public/`                                                                                                                                                                             |
| Extension Find / archive | `apps/extension/src/popup.*` (Find tab, "Keep an offline copy")                                                                                                                                                                                                          |
| Rediscover               | `saves.ts → rediscover()`, dashboard                                                                                                                                                                                                                                     |
| Backup & restore         | `server/backup.ts`, `app/backup/**`, `core/tar.ts`; daily auto-backups in `DATA_DIR/backups`                                                                                                                                                                             |
| Bookmarklet              | Settings → Browser extension (uses `/share?popup=1`)                                                                                                                                                                                                                     |
| Snooze                   | `saves.snoozed_until` (migration 0003), `lib/snooze.ts`, `components/snooze-menu.tsx`, `Z` key                                                                                                                                                                           |
| Link-rot detection       | `server/linkcheck.ts` (opt-in, hourly batches), `is:broken`, detail banner                                                                                                                                                                                               |
| Light theme              | `globals.css` token overrides, `lib/theme.ts`, `tymo_theme` cookie read in root layout                                                                                                                                                                                   |
| Service imports          | `core/services-import.ts` (Pocket, Raindrop, Instapaper, Pinboard, CSV), `importer.ts → importAuto`                                                                                                                                                                      |
| Shortcut help / g-nav    | `components/shortcuts.tsx` (`?`, `g i`, `g a`…)                                                                                                                                                                                                                          |
| Reading time             | `saves.ts → readMinutes()`                                                                                                                                                                                                                                               |
| Reader view              | `core/reader.ts` (article → blocks, no HTML), `saves.reader` (migration 0004), `/read/[id]`, `R` key                                                                                                                                                                     |
| Colour search            | `core/colors.ts`, `lib/colors-client.ts` (browser measures proxied images), `color:` + soft colour words in `core/query.ts`/`server/search.ts`                                                                                                                           |
| Rich cards + masonry     | `core/facts.ts` (JSON-LD/OG → `metadata.facts`), `product`/`quote` types, `save-card.tsx → cardKind()`, `save-list.tsx → useColumns()`                                                                                                                                   |
| Natural-language search  | `core/nlquery.ts` (rules), `ai.ts → interpretWithAi()` (on request), `ListParams.natural`, `?exact=1`                                                                                                                                                                    |
| Serendipity              | `/serendipity`, `saves.ts → serendipityQueue()/reviewSave()` (`metadata.reviewedAt`), `g r`                                                                                                                                                                              |
| Image understanding      | `server/ocr.ts` (description + text in one vision call → `metadata.imageDescription`, indexed)                                                                                                                                                                           |
| Highlights               | `core/highlights.ts` (text fragments, matching), `saves.ts → saveHighlight()/highlightsFor()`, reader selection button                                                                                                                                                   |
| claude.ai connector      | `/mcp` (`server/mcp.ts`, stateless Streamable HTTP), OAuth in `server/oauth.ts` + `app/oauth/*`, `.well-known/*`, migration 0005; tools shared via `core/mcp-tools.ts`                                                                                                   |
| Bookmarks                | `saves.is_bookmark` (migration 0006), `/bookmarks` (`components/bookmarks-view.tsx`), `core/links.ts`, `/api/v1/bookmarks`, extension “Save tabs as bookmarks”                                                                                                           |
| Mac app (no Docker)      | `scripts/mac/install.sh` (`npm run mac:install`): standalone build → `~/Library/Application Support/Tymo`, LaunchAgent `app.tymo.server`, backups to iCloud Drive via `TYMO_BACKUP_DIR`                                                                                  |
| Desktop app              | `desktop/` (Electron, own `package-lock.json`, not an npm workspace): `main.cjs` forks the standalone server via `server-entry.cjs`; `scripts/after-pack.cjs` copies it into resources; `.github/workflows/desktop.yml` builds dmg/exe/AppImage on tags or manual runs   |
| Folder sync              | `server/sync/*`: triggers → `sync_outbox` → encrypted logs in `<folder>/devices/<id>/`; import with per-field HLC last-writer-wins, tombstones, natural-key merges (tag name, link, folder), pending parents; migration 0007; Settings → Sync; tests in `sync/*.test.ts` |

New env vars (also in `.env.example` / `docker-compose.yml`): `TYMO_AI_SEMANTIC`, `TYMO_AI_EMBEDDING_MODEL`,
`TYMO_AI_EMBEDDING_BASE_URL`, `TYMO_AI_OCR`, `TYMO_AUTO_ARCHIVE`, `TYMO_AUTO_BACKUP`, `TYMO_BACKUP_DIR`, `TYMO_LINK_CHECK`.

## Open to-dos

1. **Try the AI features with a real provider** — tests use fake local servers. Quick local check:
   `ollama pull nomic-embed-text llama3.2-vision`, provider OpenAI-compatible, base URL `http://127.0.0.1:11434/v1`.
2. **Dependabot PRs** on GitHub: #3/#4 (actions v7) safe if CI passes; #5 TypeScript 7 — wait (typescript-eslint
   supports TS < 6.1); #6/#7 ESLint 10 — check plugin compatibility; Node 26 Docker image — check `@libsql/client` prebuilds.
3. **`npm audit`** reports 4 moderate advisories (dev tooling: drizzle-kit's esbuild-kit) — review.
4. Remaining roadmap: PostgreSQL adapter (Drizzle pg-core mirror + tsvector search module; the SQL uses
   SQLite-specific FTS5, json_extract, VACUUM INTO, INSERT OR IGNORE), Safari packaging (needs macOS/Xcode),
   extension store listings (`npm run package -w @tymo/extension`), a demo GIF.
5. Cloud sessions: repo side is done (`.claude/settings.json` SessionStart hook runs `scripts/cloud-session-start.sh`).

## Known gotchas

- Keyboard shortcuts only work after hydration; e2e uses a `visit()` helper that waits for network idle.
- `next dev` holds a lock per app dir: stop a running dev server before `npm run test:e2e`.
- In Claude Code cloud containers the preinstalled Chromium can be older than `@playwright/test` expects; run e2e with a
  config that sets `use.launchOptions.executablePath = "/opt/pw-browsers/chromium"` (don't run `playwright install`).
- `(app)/layout.tsx` is `force-dynamic` so nothing touches the DB at build time; `/login` calls `connection()` so auth isn't baked in at build.
- Extension session restore is extension-only (web UI offers "Open all" + "Copy URLs" fallbacks).
- Unit tests get a per-file `TYMO_DATA_DIR` (`apps/web/vitest.setup.ts`) because restore tests move `files/`.
- Background jobs (enrichment resume, embeddings backfill, hourly backup/link-check) start in `src/instrumentation.ts`.
- Vectors live in memory (`embeddings.ts`); fine for tens of thousands of saves. Changing the embedding model deletes old vectors and re-indexes.
- SSRF-safe fetchers only allow ports 80/443/8080/8443; server tests that need a real HTTP server use 127.0.0.1:8080 with
  `TYMO_UNSAFE_ALLOW_PRIVATE_FETCH=1` (see `archive.test.ts`).
