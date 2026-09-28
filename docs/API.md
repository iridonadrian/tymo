# Tymo REST API (v1)

Base URL: your Tymo server, e.g. `http://127.0.0.1:3210/api/v1`.
Every request needs an API token: `Authorization: Bearer tymo_…`
(create one in **Settings → Browser extension**, or `node apps/web/scripts/create-token.mjs`).

- JSON in, JSON out. Errors are `{ "error": "message" }` with a 4xx/5xx status.
- Rate limit: 240 requests/minute per token (`429` when exceeded).
- Browser CORS is only granted to extension origins; call the API from scripts or servers.

## Saves

| Method | Path                 | Body / query                                                                                                     | Returns                                       |
| ------ | -------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| GET    | `/saves`             | `q`, `view`, `collectionId`, `sort`, `offset`, `limit`, `semantic=0`                                             | `{ items, total, hasMore }`                   |
| POST   | `/saves`             | `url` **or** `body` (note), `title`, `tags`, `notes`, `collectionIds`, `type`, `favorite`                        | `{ id, duplicate }` (201, or 200 when merged) |
| GET    | `/saves/:id`         | `text=0` to omit text                                                                                            | save + `text` (body / page / image text)      |
| PATCH  | `/saves/:id`         | any of `title`, `description`, `notes`, `url`, `type`, `tags`, `collectionIds`, `favorite`, `archived`, `status` | updated save                                  |
| DELETE | `/saves/:id`         |                                                                                                                  | `{ ok: true }`                                |
| GET    | `/saves/:id/related` |                                                                                                                  | `{ items }`                                   |
| POST   | `/saves/:id/archive` |                                                                                                                  | `{ fileId, size, images, stylesheets }`       |
| POST   | `/saves/screenshot`  | `dataUrl` (PNG/JPEG, ≤ 8 MB), `title`, `sourceUrl`, `tags`, `notes`, `collectionIds`                             | `{ id }`                                      |

`q` uses the same language as the app: free text plus `tag:x` / `#x`, `domain:github.com`,
`type:repo`, `is:fav`, `is:unread`, `is:archived`, `in:inbox`, `collection:"Name"`,
`after:2026-01-01`, `before:…`, `color:red` (or `color:#ff6600`), `-exclude`, `"exact phrase"`.
Plain colour words ("red chair") match either the image colour or the word. With semantic
search on, free-text results also include matches by meaning (`semantic: true` on those items).
The API runs queries literally; natural-language interpretation is a UI feature.

Types include `product` and `quote`. A quote (highlight) keeps the page URL with a text
fragment (`#:~:text=…`) and is never merged into the page's own save; pass
`metadata.sourceUrl` so the reader can find it again.

`view` is `all` (default), `inbox`, `favorites` or `archive`. `sort` is `relevance`
(default with text), `newest` (default without), `oldest`, `title` or `opened`.
`limit` defaults to 30, max 200. `tags` replaces the save's tags (send the full list).

## Collections, tags, sessions

| Method | Path            | Returns / body                                                                       |
| ------ | --------------- | ------------------------------------------------------------------------------------ |
| GET    | `/collections`  | `{ collections: [{ id, name, icon, parentId }] }` (manual collections)               |
| GET    | `/tags`         | `{ tags: string[] }`                                                                 |
| GET    | `/sessions`     | recent sessions                                                                      |
| POST   | `/sessions`     | `{ name?, tabs: [{ url, title?, windowIndex, pinned?, groupTitle?, groupColor? }] }` |
| GET    | `/sessions/:id` | session with tabs in order                                                           |
| POST   | `/sessions/:id` | marks the session as restored                                                        |
| GET    | `/ping`         | `{ ok, version }` — checks URL + token                                               |

## Examples

```bash
T=tymo_…; B=http://127.0.0.1:3210/api/v1
curl -s -H "Authorization: Bearer $T" "$B/saves?q=tag:osint%20is:fav&limit=5"
curl -s -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"url":"https://example.com","tags":["read-later"]}' "$B/saves"
curl -s -X PATCH -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"status":"active","favorite":true}' "$B/saves/<id>"
```

## Remote MCP (`/mcp`)

Streamable HTTP MCP endpoint built into the server (JSON responses, stateless). Auth: an
OAuth access token from the connector flow (discovery at
`/.well-known/oauth-protected-resource/mcp` → `/.well-known/oauth-authorization-server`,
registration at `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`), or a
regular API token as `Authorization: Bearer tymo_…`. Unauthenticated calls get `401` with
`WWW-Authenticate: Bearer resource_metadata="…"`. Same tools as the stdio server below.

## MCP server

`apps/mcp` wraps this API as an [MCP](https://modelcontextprotocol.io) server so AI
assistants can search and add to your library — see the README.
