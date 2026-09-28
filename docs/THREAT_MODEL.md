# Threat Model

Scope: Tymo web app (`apps/web`), browser extension (`apps/extension`), Docker deployment.

## Assets

1. The user's library: URLs, notes, extracted page text, uploaded files. Reveals interests,
   research, travel, work — sensitive by nature.
2. API tokens (grant write access to the library).
3. AI provider API keys stored in settings.
4. The host network the server runs on (SSRF target).

## Trust boundaries

| Boundary            | Untrusted side                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Browser ↔ server    | Any request may be forged by another site the user visits (CSRF), or by anyone on the network when self-hosted. |
| Server ↔ internet   | Every page Tymo fetches is attacker-controlled HTML, headers, redirects and DNS.                                |
| Uploads / imports   | Files and bookmark exports are attacker-controlled bytes.                                                       |
| Stored content → UI | Titles, descriptions, URLs, notes originate from arbitrary web pages.                                           |
| Extension ↔ pages   | Web pages must not be able to talk to the extension or read its token.                                          |

## Threats and mitigations

### SSRF via metadata fetching (highest risk)

A user (or a malicious import, or a page that redirects) makes the server fetch
`http://169.254.169.254/…`, `http://localhost:5432`, or an internal admin panel.

Mitigations (`apps/web/src/server/fetcher.ts`, `packages/core/src/net.ts`):

- Only `http:`/`https:`; no credentials in URLs; ports limited to 80, 443, 8080, 8443.
- Hostnames `localhost`, `*.localhost`, `*.local`, `*.internal`, `metadata.google.internal` rejected before DNS.
- **DNS resolution is validated inside the socket `lookup` hook**, so the address that is
  checked is the address that is connected to (defeats DNS rebinding / TOCTOU).
- Every resolved address is checked against private, loopback, link-local, CGNAT,
  multicast, reserved, documentation, benchmarking, IPv4-mapped/NAT64-embedded IPv6, ULA, and unspecified ranges.
- Redirects are followed manually (max 5) and each hop is re-validated.
- 8 s total timeout, 1.5 MB body cap (stream aborted beyond), `text/html` / `xhtml` only.
- No cookies or auth headers are ever sent; fixed User-Agent.
- An explicit, loudly named escape hatch `TYMO_UNSAFE_ALLOW_PRIVATE_FETCH=1` exists for
  intranet users and tests. Off by default.

### XSS via stored content

Titles/descriptions/notes come from hostile pages.

- React escapes all text; `dangerouslySetInnerHTML` is banned (lint rule).
- URLs are validated to `http(s)` on write **and** passed through `safeHref()` on render,
  so `javascript:`/`data:` links can never become clickable.
- Image URLs (favicons, previews) must be `http(s)` and are only ever loaded through the
  same-origin image proxy (see below), so CSP `img-src` is `'self' data: blob:`.
- The reader view never stores or renders page HTML: `core/reader.ts` reduces the page to
  plain data blocks (text runs, headings, lists, code, tables, image URLs), rendered as
  ordinary React elements. Links in it are resolved to absolute `http(s)` URLs and pass
  through `safeHref()`; images go through the image proxy. Output is size-capped.
- Image colours are measured in the browser from same-origin (proxied) images and sent back
  as `#rrggbb` values validated by Zod; colour names used for search are derived on the
  server, never taken from the client.
- AI query interpretation only rewrites the search box text (control characters stripped,
  300 chars max, rate-limited); it runs through the normal query parser like typed input.
- Strict CSP: `script-src 'self' 'nonce-…'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`.

### Malicious uploads (images, PDFs, screenshots)

- Allow-list by **magic bytes**, not extension or declared type: PNG, JPEG, GIF, WebP, PDF. SVG and HTML are rejected.
- Size limit (25 MB uploads, 8 MB screenshots).
- Stored under `DATA_DIR/files/<random id>`; the user-supplied filename is never used as a path → no path traversal.
- Served with the stored MIME type, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: sandbox`, and `Content-Disposition` (PDFs `attachment` by default).
- Tymo never parses PDFs server-side (no PDF.js/Poppler attack surface in MVP).

### Image proxy (`/img?u=…`, `server/images.ts`)

- Fetches go through `safeFetchBytes()`: identical SSRF controls to metadata fetching
  (DNS-pinned address checks, re-validated redirects, timeouts), 5 MB cap.
- The response must sniff as PNG/JPEG/GIF/WebP/AVIF/ICO/BMP/SVG; anything else is a 404.
  Served with the sniffed type, `nosniff`, and `Content-Security-Policy: sandbox`, so an
  SVG opened directly cannot run script in Tymo's origin.
- Behind the password gate like every page; max 6 concurrent upstream fetches; results
  (including failures, for 1 h) cached under `DATA_DIR/cache/img`, pruned to 256 MB.

### Archived pages (`server/archive.ts`, `packages/core/src/archive.ts`)

Archives are the only HTML Tymo stores, and they come from hostile pages.

- Fetched with `safeFetch`/`safeFetchBytes` (SSRF controls above); images via the image proxy.
- Rewritten with a tokenizer: `<script>`, frames, `<object>`, `<template>`, `<base>`,
  refresh/CSP/charset metas, non-stylesheet `<link>`s, comments, `on*` attributes,
  `srcset`/`srcdoc`/`action`/`ping`, and every non-http(s) URL are removed. Stylesheets and
  images are inlined (CSS ≤ 1 MB each, images ≤ 12 MB total as `data:` URIs); `</style`
  inside CSS is escaped so it can't break out.
- Served from `/files/:id` with `Content-Security-Policy: sandbox allow-popups
allow-popups-to-escape-sandbox; default-src 'none'; img-src data:; style-src
'unsafe-inline'; font-src data:; form-action 'none'` — no scripts, no same-origin
  access, no network, no forms. Links open in a new tab only on click.
- Imports never archive; automatic archiving is off by default.

### Malicious bookmark / JSON imports

- Parsed with `htmlparser2` (tokenizer), a small RFC 4180 CSV parser (Pocket, Raindrop,
  Instapaper, generic) or `JSON.parse` + Zod (Tymo, Pinboard). Size capped at 20 MB, 50k items.
- Every imported URL re-validated; non-http(s) entries (e.g. `javascript:` bookmarklets) dropped.
- Imports do **not** trigger network fetches (prevents mass SSRF/scanning via an import file).

### Backup restore (`POST /backup`, `server/backup.ts`)

Restoring replaces the whole library, so it is the most destructive endpoint.

- Same-origin only: `Origin` must match `Host` and `Sec-Fetch-Site`, when present, must be
  `same-origin` (route handlers don't get Server Actions' CSRF check). Behind the password gate.
- Streamed, never buffered whole; gunzip + a strict tar parser: regular files only, names
  limited to `manifest.json`, `tymo.db` and `files/<uuid>` (no traversal), checksums verified,
  size and entry-count caps; files are created with `wx` in a fresh staging folder.
- The database is checked (`PRAGMA quick_check`, required tables) before anything is
  swapped; the current data is moved to `DATA_DIR/.pre-restore-<time>/`, never deleted.
- Backups contain the AI API key if one is stored in settings — treat them as secrets.

### DNS rebinding (local mode)

Without a password, anything that can reach the port is trusted. A malicious website can
resolve its own domain to `127.0.0.1` and then talk to Tymo same-origin: read `/export` or
`/backup`, call Server Actions (their Origin check passes because Origin equals Host).

- `src/proxy.ts` + `server/hosts.ts`: in no-password mode, requests are only accepted when the
  `Host` header is `localhost`, `127.0.0.1`, `::1`, an IP literal, or listed in
  `TYMO_ALLOWED_HOSTS`. Anything else gets `421`. With a password the session cookie (bound to
  the real host) already blocks this.

### Information disclosure

- Errors shown in the UI or returned by the API go through `publicErrorMessage()`
  (`server/privacy.ts`): system errors collapse to a generic message with their code, and
  absolute paths (which reveal usernames and folders) are stripped. Details stay in server logs.
- Settings shows the data directory with the home folder shortened to `~`.
- Outgoing requests use a generic `User-Agent: Mozilla/5.0 (compatible; Tymo)` — no repository
  URL, owner name or version.
- `X-Forwarded-For` is only trusted with `TYMO_TRUST_PROXY=1`; otherwise it is spoofable, so
  login rate limiting uses one shared bucket (brute force stays capped).

### CSRF

- UI mutations are Server Actions, which Next.js restricts to same-origin (`Origin` must match `Host`).
- `/api/v1` authenticates only via `Authorization: Bearer` — browsers never attach it automatically.
- Login cookie is `HttpOnly`, `SameSite=Lax`, `Secure` when served over HTTPS.
- Export `GET` endpoints are side-effect free.

### Authentication / authorization

- Local mode: server binds `127.0.0.1` by default in the start scripts; no auth.
- Self-hosted: `TYMO_PASSWORD` enables a middleware gate on every route except `/login`
  and `/api/v1/*` (token-auth). Session cookie is an HMAC-SHA256 signed expiry; password
  comparison is constant-time. The Docker entrypoint refuses to start with `0.0.0.0`
  binding unless `TYMO_PASSWORD` is set or `TYMO_ALLOW_NO_AUTH=1` is explicit, and refuses
  passwords shorter than 8 characters when exposed (warns under 12).
- API tokens: 32 random bytes, stored as SHA-256, revocable, `last_used_at` tracked.

### API abuse / brute force

- In-memory token-bucket rate limiting on `/login` (5/min per client, see `TYMO_TRUST_PROXY`),
  `/api/v1` (240/min/token), failed API tokens (20/min per client, then 429) and AI search
  interpretation (20/min).
- Request body size limits on every endpoint.

### Extension

- No content scripts, no `<all_urls>`, host permission requested only for the configured
  server origin. Pages cannot message the extension (no `externally_connectable`).
- Token kept in `storage.local` (not `sync`), never exposed to pages.
- Server URL must be `https:` unless it is `localhost`/`127.0.0.1` (warns otherwise).

### AI data flows (all opt-in, off by default)

- Suggestions send title, URL and ≤ 6,000 chars of text; embeddings send title, description,
  tags, notes and ≤ 2,500 chars; OCR sends the image bytes. Each is a separate toggle.
- Page text and image content are marked as untrusted data in the prompts; model output is
  only ever stored as plain text, reviewed before applying (suggestions), and rendered escaped.
- The chat API key is never sent to a different embeddings endpoint.
- The AI base URL is set by the owner (Settings, behind the password gate, or env) and is
  deliberately allowed to point at local services such as Ollama, so it does not go through
  the SSRF filter. Provider responses are size-capped (16 MB) and time-limited.
- Ollama keeps every AI request on the owner's machine.

### MCP server (`apps/mcp`)

- Runs as a local stdio process started by the owner's AI client, talking to the REST API
  with a revocable token; warns when that token would cross the network over plain HTTP.
- Prompt injection from saved pages: stored text is fenced as untrusted in tool results and
  tool descriptions say titles/descriptions are data. There is no delete tool; the most
  destructive action (archive) is reversible.

### Secrets

- AI keys stored in the local DB (single-user, local file). Never returned to the client
  after save (UI shows `••••` + last 4). Env vars override DB values for self-hosters.
- Backups scrub the AI key from their database copy (with `secure_delete`), so a backup
  file never carries it. API tokens are only stored as hashes.
- `TYMO_BACKUP_DIR` may point at a synced folder (iCloud Drive, Dropbox…). Backups are not
  encrypted by Tymo, so that provider can read the library; use an encrypted disk or the
  provider's end-to-end option (e.g. iCloud Advanced Data Protection) if that matters.
- The macOS installer (`scripts/mac/install.sh`) binds the server to `127.0.0.1` and keeps
  the app and data folders `chmod 700`; the LaunchAgent runs as the logged-in user.
- `.env*` files are git-ignored.

### Desktop app (`desktop/`)

- The server runs on `127.0.0.1` only; the window has `contextIsolation`, `sandbox`, no
  Node integration and no preload. Other origins never load in the app window: links go
  to the default browser (only `http(s)`/`mailto`).
- Update check: one HTTPS request a day to the GitHub releases API (can be turned off).
  Downloads are accepted only over HTTPS from GitHub hosts and must match the size the
  API reports; the user opens and installs them. Builds are unsigned (ad-hoc on macOS),
  so authenticity rests on GitHub's TLS and account security. Signing and notarization
  are the upgrade path.

### Dependencies and supply chain

- Small dependency set; lockfile committed; `npm audit` in CI; Dependabot config.
  `npm audit` (including dev tooling) reports 0 vulnerabilities; drizzle-kit's bundled
  esbuild is pinned to a patched version through `overrides`.
- No postinstall scripts of our own.

### Remote MCP connector (`/mcp`, `/oauth/*`, `server/oauth.ts`)

- OAuth 2.1 per the MCP authorization spec: protected-resource and authorization-server
  metadata, dynamic client registration for public clients, authorization code + PKCE S256
  only (no implicit, no password grant), `resource` bound to this server's `/mcp`.
- Only works with `TYMO_PASSWORD`: the consent page sits behind the password gate, so only
  the owner can approve. Its server action is only callable from that gated page (Next.js
  rejects actions posted to pages that don't use them; verified against a production build).
- Consent phishing (an attacker registers a client named "Claude" with their own redirect
  URI and sends the owner the link): the page states that the name is self-chosen and shows
  the redirect host. Redirect URIs must be https, or http on loopback; they must match the
  registration exactly, and invalid requests are shown on the page, never redirected.
- Codes: 256-bit, hashed, single use, 10 minutes, bound to client, redirect URI and PKCE
  challenge. A replayed code revokes the tokens it produced. Access tokens last 1 hour;
  refresh tokens 30 days and rotate on use (the old one dies immediately). All hashed.
- Scopes: `library:read` and `library:write`; the owner can grant read-only, in which case
  write tools are not even listed. No tool can delete.
- Registration is unauthenticated by design (RFC 7591): throttled (10/min per client),
  capped at 200 clients, and clients without a grant are pruned after a day.
- `/mcp` and the OAuth endpoints allow any CORS origin: they use bearer tokens and PKCE, never
  cookies. Failed bearer tokens are throttled; each grant is limited to 240 calls/min.
- Behind a proxy, set `TYMO_PUBLIC_URL` so issuer/resource URLs don't depend on headers.

### Transport

- `Strict-Transport-Security` is sent on every response (browsers only honour it over HTTPS),
  plus `nosniff`, `no-referrer`, `DENY` framing, a Permissions-Policy and COOP. The session
  cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` behind HTTPS.

### Container

- Multi-stage build, runs as non-root `node` user, read-only root filesystem compatible
  (writes only to `/data`), no shell tooling needed at runtime, healthcheck.

### Webhooks

Tymo has no inbound webhooks in the MVP. If added, they must use HMAC signatures with
timestamps and replay windows.

## Residual risks (accepted)

- The server fetches pages (and their favicons/preview images) the user saves; those sites
  learn the server's IP, not the browser's. With link checking on, each saved URL is also
  requested about once a month (first 1 KB only, same SSRF controls).
- Local mode has no auth: any local process can reach `127.0.0.1:3210`.
- In-memory rate limits reset on restart and aren't shared across replicas (single process by design).
