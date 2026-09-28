# Tymo — Project Spec

> Open-source digital memory for the internet. **Save it. Close it. Find it later.**

## Problem

People keep tabs open because closing them feels like forgetting. That costs memory,
battery and focus. Bookmarks don't help: they are slow to file and impossible to search.

## Promise

Capturing something into Tymo must be faster than leaving the tab open, and finding it
again must be faster than scrolling through tabs.

```
SAVE → (auto metadata) → (optional AI) → CLOSE TAB → FIND LATER
```

## Principles

1. Capture in one action (click, shortcut, or context menu).
2. Organization is optional. Everything lands in the **Inbox**; filing is a quick, later step.
3. Search is the primary retrieval path: full text, filters, keyboard first (`⌘/Ctrl K`).
4. Local-first: SQLite + local files, no account, no telemetry.
5. AI is an add-on. Every feature works without it; every AI suggestion is editable.
6. Calm, dense, fast UI. Thousands of items must be browsable.
7. Your data is portable: JSON / CSV / HTML bookmarks / Markdown export at any time.

## Core concepts

| Concept        | Meaning                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| **Save**       | Universal item: URL, article, repo, video, image, screenshot, PDF, note…    |
| **Inbox**      | Newly captured Saves not yet filed. Filing = add to a collection or "Done". |
| **Collection** | Long-lived topic ("Cybersecurity"). Manual or **smart** (rule-based).       |
| **Tag**        | Lightweight label, no hierarchy.                                            |
| **Session**    | A snapshot of tabs researched together at one point in time. Restorable.    |

A Save may belong to many collections, carry many tags, and appear in many sessions.

## MVP definition of done

A user can: open the app → create a collection → save a URL → metadata is fetched
automatically → add tags → search → open it → save 50+ more → browse them efficiently →
save a browser session from the extension → close those tabs → later restore the session.

## Milestones

| #   | Scope                                                                                                                                                           | Status                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Setup, DB, Save model, dashboard, create/save, collections (nested), tags, FTS search, ⌘K palette                                                               | Done                                                                                                                                               |
| 2   | Browser extension (Chromium + Firefox MV3), save current tab, SSRF-safe metadata extraction                                                                     | Done                                                                                                                                               |
| 3   | Save all tabs → Sessions (windows, order, pins, tab groups), close saved tabs, restore                                                                          | Done                                                                                                                                               |
| 4   | Screenshots (extension), image/PDF uploads, notes & snippets, bookmark/JSON import, JSON/CSV/HTML/MD export                                                     | Done (no OCR)                                                                                                                                      |
| 5   | Optional AI (OpenAI-compatible/Ollama, Anthropic, Gemini): suggested title/description/tags/collection/summary with review; smart collections with live preview | Done — **semantic search, embeddings, AI duplicate detection and natural-language search deferred** (URL-normalized duplicate merging is built in) |
| 6   | Docker (non-root, read-only), password gate, CSP, rate limiting, CI                                                                                             | Done — **PostgreSQL adapter deferred** (see ARCHITECTURE.md)                                                                                       |
| 7   | Image proxy, semantic search (hybrid with FTS) + related saves, duplicate detection/merge, full-page archiving, OCR via vision models                           | Done — PostgreSQL adapter still deferred                                                                                                           |

## Explicit non-goals (for now)

Collaboration, public sharing, native apps, Safari extension build, sync, MCP server,
bots, RSS, PostgreSQL. The data model and
architecture leave room for each of them (see `ARCHITECTURE.md → Extension points`).
