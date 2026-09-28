# Contributing to Tymo

Thanks for helping! Tymo aims to stay **small, fast and trustworthy**. Before adding a
feature, ask: does it make _save → close → find later_ faster or more reliable?

## Setup

```bash
git clone <repository-url> tymo && cd tymo
npm install
npm run dev            # http://127.0.0.1:3210
```

Requirements: Node 22+. No database server needed (SQLite lives in `apps/web/data/`).

## Everyday commands

| Command                              | What it does                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `npm run dev`                        | Web app with hot reload                                                              |
| `npm test`                           | Unit + integration tests (Vitest)                                                    |
| `npm run test:e2e`                   | Browser tests (Playwright; run `npx playwright install chromium` once in `apps/web`) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript                                                                  |
| `npm run build -w @tymo/extension`   | Build extension into `apps/extension/dist/{chrome,firefox}`                          |
| `npm run db:generate -w @tymo/web`   | Create a migration after editing `src/server/db/schema.ts`                           |

## Where things live

- `packages/core` — pure logic (no I/O). Put parsing/validation here, with tests.
- `apps/web/src/server` — database, search, fetcher, files, AI. Server-only.
- `apps/web/src/components` — client UI.
- `apps/extension/src` — WebExtension.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Rules of the road

- Validate every external input with Zod. Server Actions and API routes are public endpoints.
- Never render raw HTML; use `safeHref()` for any URL placed in `href`/`src`.
- Any code that fetches a URL must go through `safeFetch()`.
- New tables/columns → migration via drizzle-kit; never edit an applied migration.
- Keep the UI dense and calm; use the design tokens in `globals.css`.
- Add tests for bug fixes. PRs must pass `lint`, `typecheck`, `test`, `build`.

## Commit / PR

Small, focused PRs with a clear description of _why_. Security-sensitive changes should
update `docs/THREAT_MODEL.md`. Report vulnerabilities privately (see `SECURITY.md`).

By contributing you agree your work is licensed under the MIT license and that you'll
follow the [Code of Conduct](CODE_OF_CONDUCT.md).
