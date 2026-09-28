# Tymo — guide for Claude

Open-source, local-first "save it, close it, find it later" app. **Start with `docs/HANDOFF.md`** (current state + to-dos). Read `docs/ARCHITECTURE.md`
and `docs/THREAT_MODEL.md` before non-trivial changes.

## Layout

- `packages/core` — pure TS (no I/O): schemas, URL/SSRF policy, type detection, HTML metadata, bookmarks, query parser, smart rules. Tests next to sources.
- `apps/web` — Next.js 16 App Router. `src/server/*` is server-only (DB via Drizzle + libSQL, FTS5 search, `safeFetch`, files, AI). UI in `src/components`. Next 16 differs from older versions: middleware is `src/proxy.ts`; check `node_modules/next/dist/docs/` when unsure.
- `apps/extension` — MV3 WebExtension (esbuild) for Chromium + Firefox.

## Commands (run from repo root)

- `npm run dev` → http://127.0.0.1:3210
- `npm test` (Vitest, ~1s) · `npm run lint` · `npm run typecheck` · `npm run format:check`
- `npm run test:e2e` (Playwright; needs Chromium installed)
- `npm run build` (web + extension) · `npm run db:generate -w @tymo/web` after schema edits

## Rules

- Validate all external input with Zod; Server Actions and `/api/v1` routes are public endpoints.
- Never render raw HTML (`dangerouslySetInnerHTML`/`innerHTML` are lint errors). Put URLs through `safeHref()`.
- Any server-side URL fetch goes through `safeFetch()` (SSRF). Imports must never fetch.
- Schema change → new drizzle migration; never edit applied migrations. FTS rows are keyed by `saves.seq`; call `reindexSave()` after changing searchable fields.
- Keep the UI dense/calm and use the tokens in `apps/web/src/app/globals.css` — never hardcode colours (light and dark themes share them).
- Before finishing: lint, typecheck, test, and build must pass.
