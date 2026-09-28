# Security Policy

Tymo stores a personal record of what someone reads, researches and plans. We treat
security as a core feature. The full threat model is in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting
(Security → Report a vulnerability) on this repository. Include steps to reproduce,
affected version/commit, and impact. We aim to acknowledge within 72 hours and to ship a
fix or mitigation for high-severity issues within 14 days. We're happy to credit reporters.

## Supported versions

Only the latest release on `main` receives security fixes while the project is pre-1.0.

## Security design at a glance

| Area         | Decision                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSRF         | Server fetches are validated before DNS and again **at connect time** (socket lookup hook), redirects re-validated, private/loopback/link-local/metadata ranges blocked, 8 s timeout, 1.5 MB cap, HTML only. |
| XSS          | React escaping only; `dangerouslySetInnerHTML`/`innerHTML` banned by lint; every href/src passes `safeHref()` (http/https only); strict CSP with per-request nonce.                                          |
| Uploads      | Magic-byte allow-list (PNG/JPEG/GIF/WebP/PDF; no SVG/HTML), size limits, random storage keys (no user paths), served with `nosniff` + `CSP: sandbox`, PDFs as attachments.                                   |
| CSRF         | UI mutations are same-origin Server Actions; extension API uses bearer tokens only.                                                                                                                          |
| Auth         | Local mode binds 127.0.0.1. `TYMO_PASSWORD` enables an HMAC-signed, HttpOnly session cookie. Docker refuses to bind publicly without a password unless explicitly overridden.                                |
| Tokens       | 256-bit random, stored as SHA-256, revocable, rate-limited.                                                                                                                                                  |
| Extension    | No content scripts, no `<all_urls>`; host permission requested for the user's server origin only.                                                                                                            |
| Imports      | Parsed with a tokenizer + Zod, capped at 20 MB / 50k items, never trigger network fetches.                                                                                                                   |
| Exports      | CSV cells escaped against formula injection.                                                                                                                                                                 |
| Privacy      | No telemetry, no analytics, no account. AI is off by default and discloses what is sent.                                                                                                                     |
| Supply chain | Small dependency set, lockfile, `npm audit` + Dependabot in CI, non-root read-only container.                                                                                                                |

## Known limitations

See "Residual risks" in the threat model: remote favicons/preview images are loaded
directly by the browser (reveals your IP to those hosts), and local mode has no auth by design.
