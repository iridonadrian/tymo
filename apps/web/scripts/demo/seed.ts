/**
 * Builds a demo library straight into a data folder, offline and the same every time, for
 * screenshots and trying Tymo out. Never point it at a real library.
 *
 *   TYMO_DATA_DIR=/some/empty/folder npx tsx apps/web/scripts/demo/seed.ts
 *
 * Images are the SVG illustrations in images.mjs, rendered to PNG with Playwright's
 * Chromium (set TYMO_CHROMIUM to use another executable).
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { chromium } from "@playwright/test";
import type { CreateSaveInput, SmartRules } from "@tymo/core";
import { extractReader, readerText } from "@tymo/core/reader";
import { getDb, schema } from "../../src/server/db";
import { createSave, insertSave, saveHighlight } from "../../src/server/saves";
import { createCollection } from "../../src/server/collections";
import { storeFile } from "../../src/server/files";
import { newId } from "../../src/server/ids";
import { reindexSave } from "../../src/server/search";
import { IMAGES } from "./images.mjs";

const dataDir = process.env.TYMO_DATA_DIR;
if (!dataDir) throw new Error("Set TYMO_DATA_DIR to an empty folder");
if (fs.existsSync(path.join(dataDir, "tymo.db")))
  throw new Error(`${dataDir} already has a library; use an empty folder`);

const DAY = 86_400_000;
const HOUR = 3_600_000;
const now = Date.now();

async function renderImages(): Promise<Record<keyof typeof IMAGES, Buffer>> {
  const browser = await chromium.launch({
    executablePath: process.env.TYMO_CHROMIUM || undefined,
  });
  const page = await browser.newPage();
  const out = {} as Record<keyof typeof IMAGES, Buffer>;
  for (const [name, markup] of Object.entries(IMAGES) as [keyof typeof IMAGES, string][]) {
    const [, w, h] = markup.match(/width="(\d+)" height="(\d+)"/)!.map(Number);
    await page.setViewportSize({ width: w!, height: h! });
    await page.setContent(`<!doctype html><style>*{margin:0}svg{display:block}</style>${markup}`);
    out[name] = await page.locator("svg").screenshot({ type: "png" });
  }
  await browser.close();
  return out;
}

const images = await renderImages();
const db = await getDb();

/* ---------------------------------------------------------------- collections */

const col: Record<string, string> = {};
for (const [key, name, icon, description] of [
  ["design", "Design", "🎨", "Inspiration, type and tools"],
  ["dev", "Dev tools", "🧰", "Things that make building nicer"],
  ["reading", "Reading", "📚", "Books and long reads"],
  ["kitchen", "Kitchen", "🍳", "Recipes to cook this month"],
  ["travel", "Travel", "✈️", "Places for the next trip"],
  ["home", "Living", "🪴", "Furniture and small things"],
] as const) {
  col[key] = await createCollection({ name, icon, description });
}
const smart: SmartRules = {
  groups: [
    [{ field: "domain", op: "contains", value: "github.com" }],
    [{ field: "tag", op: "is", value: "open-source" }],
  ],
};
await createCollection({ name: "Open source", icon: "✨", rules: smart });

/* ---------------------------------------------------------------- saves */

type Seed = CreateSaveInput & {
  ago: number; // milliseconds before now
  image?: keyof typeof IMAGES;
  inbox?: boolean;
  html?: string; // article body for the reader view
  text?: string; // extracted text for search
};

const ids: Record<string, string> = {};

async function add(key: string, s: Seed) {
  const { ago, image, inbox, html, text, ...input } = s;
  const r = await createSave(input, {
    metadataStatus: "none",
    createdAt: now - ago,
    status: inbox ? "inbox" : "active",
    extractedText: text,
    captureMethod: "extension",
  });
  ids[key] = r.id;
  if (image) await storeFile(images[image], { saveId: r.id, kind: "screenshot" });
  if (html && input.url) {
    const reader = extractReader(html, input.url, input.title);
    const words = reader?.words ?? 0;
    await db
      .update(schema.saves)
      .set({
        reader,
        extractedText: reader ? readerText(reader) : null,
        metadata: sql`json_set(coalesce(metadata, '{}'), '$.words', ${words}, '$.author', 'Ines Okafor', '$.siteName', 'Field Notes')`,
      })
      .where(sql`id = ${r.id}`);
    await reindexSave(db, r.id);
  }
  return r.id;
}

const para = (t: string) => `<p>${t}</p>`;
const ARTICLE = `<!doctype html><html><head><title>Local-first software, five years on</title></head><body>
<header><nav><a href="/">Field Notes</a></nav></header>
<article>
<h1>Local-first software, five years on</h1>
${para("Five years ago a group of researchers asked a simple question: why does the software we rely on most stop working the moment the network does? Their answer was a set of ideals for <em>local-first</em> software — apps where your data lives on your own device first, and the cloud is a convenience rather than a landlord.")}
${para("The ideals were easy to agree with and hard to build. Fast, because nothing waits on a round trip. Multi-device, because your laptop and phone should agree. Offline, because trains and planes exist. Collaborative, long-lived, private, and — the one that matters most — under the user's ultimate ownership and control.")}
<h2>What changed</h2>
${para("Three things made the ideals practical. Embedded databases grew up: SQLite now ships full-text search, JSON functions and write-ahead logging, and it runs everywhere from a phone to a browser tab. Sync engines became libraries instead of research projects. And people started to notice what they lose when a service shuts down and takes a decade of notes with it.")}
<blockquote><p>The best time to own your data was before the service shut down. The second best time is now.</p></blockquote>
${para("Plain files turned out to be the most durable format of all. A single database file can be copied, backed up, synced by any folder-sync tool and opened in twenty years by software that does not exist yet. That is a stronger promise than any terms of service.")}
<h2>What is still hard</h2>
<ul><li>Merging edits made on two devices without asking the user to resolve conflicts.</li><li>Search that is as good offline as a cloud index.</li><li>Backups people actually set up.</li></ul>
${para("None of these are solved, but each has good-enough answers today. The remaining gap is mostly taste: building tools that feel calm, fast and finished, so choosing the local-first option never feels like a sacrifice.")}
</article><footer>Subscribe · About</footer></body></html>`;

await add("article", {
  url: "https://fieldnotes.blog/local-first-five-years-on",
  title: "Local-first software, five years on",
  description:
    "Embedded databases grew up, sync became a library, and plain files proved the most durable format of all.",
  type: "article",
  tags: ["local-first", "sqlite", "essay"],
  collectionIds: [col.reading!],
  image: "heroLocal",
  html: ARTICLE,
  ago: 1 * HOUR,
});
await add("calm", {
  url: "https://fieldnotes.blog/designing-calm-interfaces",
  title: "Designing calm interfaces",
  description:
    "Fewer colours, fewer badges, fewer surprises. Notes on interfaces that stay out of the way.",
  type: "article",
  tags: ["design", "ux"],
  collectionIds: [col.design!],
  image: "heroCalm",
  ago: 10 * HOUR,
});
await add("chair", {
  url: "https://northform.studio/products/arc-lounge-chair",
  title: "Arc lounge chair — tomato red",
  description: "Solid oak frame, wool upholstery. Made to order in six weeks.",
  type: "product",
  tags: ["furniture", "wishlist"],
  collectionIds: [col.home!],
  image: "chair",
  metadata: {
    facts: { kind: "product", price: 890, currency: "EUR", brand: "Northform", inStock: true },
  },
  ago: 2 * HOUR,
});
await add("pasta", {
  url: "https://slowkitchen.co/recipes/weeknight-tomato-pasta",
  title: "Weeknight tomato & basil pasta",
  description: "Blistered cherry tomatoes, garlic and a lot of basil. Dinner in twenty minutes.",
  type: "recipe",
  tags: ["recipes", "quick", "vegetarian"],
  collectionIds: [col.kitchen!],
  image: "pasta",
  metadata: {
    facts: { kind: "recipe", minutes: 20, ingredients: 7, rating: 4.8, ratingCount: 312 },
  },
  ago: 3 * HOUR,
});
await add("quote1", {
  type: "quote",
  title: "Simplicity",
  body: "Simplicity is not the absence of clutter; that's a consequence of simplicity. Simplicity is somehow describing the purpose and place of an object and product.",
  tags: ["design"],
  ago: 30 * HOUR,
});
await add("mug", {
  url: "https://claywork.shop/stoneware-mug-sea",
  title: "Stoneware mug, sea glaze",
  description: "Hand-thrown, 350 ml. Every glaze comes out a little different.",
  type: "product",
  tags: ["wishlist", "kitchen"],
  collectionIds: [col.home!],
  image: "mug",
  metadata: { facts: { kind: "product", price: 34, currency: "EUR", brand: "Claywork" } },
  ago: 22 * HOUR,
});
await add("ollama", {
  url: "https://github.com/ollama/ollama",
  title: "ollama/ollama",
  description: "Get up and running with large language models, locally.",
  type: "repo",
  tags: ["ai", "local-first", "open-source"],
  collectionIds: [col.dev!],
  ago: 12 * HOUR,
});
await add("mountains", {
  url: "https://en.wikipedia.org/wiki/Dolomites",
  title: "Dolomites at sunset",
  type: "image",
  tags: ["travel", "hiking"],
  collectionIds: [col.travel!],
  image: "mountains",
  ago: 5 * HOUR,
});
await add("book1", {
  url: "https://openlibrary.org/works/quiet-internet",
  title: "The Quiet Internet",
  description: "Essays on small websites, slow software and the people who make them.",
  type: "book",
  tags: ["books", "to-read"],
  collectionIds: [col.reading!],
  image: "bookQuiet",
  metadata: { facts: { kind: "book", author: "Mara Lindqvist", year: 2024, rating: 4.4 } },
  ago: 8 * HOUR,
});
await add("note1", {
  type: "note",
  title: "Gift ideas",
  body: "Mum — the sea-glaze mug\nSam — Small Tools (hardback)\nLeo — film camera strap\n\nOrder before the 10th.",
  tags: ["personal"],
  ago: 14 * HOUR,
  inbox: true,
});
await add("terminal", {
  title: "FTS5 query that finally worked",
  type: "screenshot",
  tags: ["sqlite", "snippets"],
  collectionIds: [col.dev!],
  image: "terminal",
  text: "sqlite3 tymo.db SELECT title FROM saves_fts WHERE saves_fts MATCH 'local first' ORDER BY rank",
  ago: 20 * HOUR,
});
await add("gate", {
  url: "https://en.wikipedia.org/wiki/Fushimi_Inari-taisha",
  title: "Fushimi Inari, early morning",
  description: "Go before 7am — the upper trail is almost empty.",
  type: "place",
  tags: ["japan", "travel"],
  collectionIds: [col.travel!],
  image: "gate",
  ago: 6 * HOUR,
});
await add("tart", {
  url: "https://slowkitchen.co/recipes/lemon-tart",
  title: "Proper lemon tart",
  description: "Crisp pastry, sharp curd, no cracks.",
  type: "recipe",
  tags: ["recipes", "baking"],
  collectionIds: [col.kitchen!],
  image: "tart",
  metadata: {
    facts: { kind: "recipe", minutes: 95, ingredients: 9, rating: 4.6, ratingCount: 88 },
  },
  ago: 2 * DAY,
});
await add("snippet", {
  type: "snippet",
  title: "Kill whatever is on a port",
  body: "lsof -ti tcp:3210 | xargs kill",
  tags: ["snippets", "shell"],
  collectionIds: [col.dev!],
  ago: 10 * DAY,
});
await add("poster", {
  url: "https://www.themoviedb.org/movie/northern-lights",
  title: "Northern Lights",
  description: "A lighthouse keeper, a winter storm and a very long night.",
  type: "movie",
  tags: ["movies", "watchlist"],
  image: "poster",
  metadata: { facts: { kind: "movie", year: 2023, director: "Aino Virtanen", rating: 4.1 } },
  ago: 36 * HOUR,
});
await add("palette", {
  title: "Terracotta / sea / sand palette",
  type: "image",
  tags: ["design", "colour"],
  collectionIds: [col.design!],
  image: "palette",
  ago: 52 * HOUR,
});
await add("lamp", {
  url: "https://northform.studio/products/task-lamp",
  title: "Task lamp, signal yellow",
  type: "product",
  tags: ["furniture", "desk"],
  collectionIds: [col.home!],
  image: "lamp",
  metadata: { facts: { kind: "product", price: 180, currency: "EUR", brand: "Northform" } },
  ago: 3 * DAY,
});
await add("book2", {
  url: "https://openlibrary.org/works/small-tools",
  title: "Small Tools",
  description: "On making software by hand, for a few people who care.",
  type: "book",
  tags: ["books", "software"],
  collectionIds: [col.reading!],
  image: "bookTools",
  metadata: { facts: { kind: "book", author: "Theo Brandt", year: 2022 } },
  ago: 40 * DAY,
});

const links: [string, string, string, string[], string, number, boolean?][] = [
  [
    "sqlite",
    "https://sqlite.org/fts5.html",
    "SQLite FTS5 Extension",
    ["sqlite", "search"],
    "dev",
    11 * DAY,
  ],
  [
    "drizzle",
    "https://orm.drizzle.team/docs/overview",
    "Drizzle ORM — overview",
    ["typescript", "databases"],
    "dev",
    16 * DAY,
  ],
  [
    "mdn",
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP",
    "Content Security Policy (CSP) — MDN",
    ["web", "security", "read-later"],
    "dev",
    20 * DAY,
  ],
  [
    "hn",
    "https://news.ycombinator.com/item?id=1",
    "Show HN: a local-first app for everything you save",
    ["local-first"],
    "reading",
    5 * DAY,
    true,
  ],
  [
    "mcp",
    "https://modelcontextprotocol.io/",
    "Model Context Protocol",
    ["ai", "open-source"],
    "dev",
    9 * DAY,
  ],
  [
    "lucide",
    "https://lucide.dev/icons/",
    "Lucide icons",
    ["design", "icons", "open-source"],
    "design",
    35 * DAY,
  ],
  [
    "kyoto",
    "https://en.wikipedia.org/wiki/Kyoto",
    "Kyoto — Wikipedia",
    ["japan", "travel"],
    "travel",
    50 * DAY,
  ],
  [
    "fonts",
    "https://fonts.google.com/specimen/Inter",
    "Inter — a typeface for screens",
    ["design", "type"],
    "design",
    70 * DAY,
  ],
];
for (const [key, url, title, tags, c, ago, inbox] of links) {
  await add(key, { url, title, tags, collectionIds: inbox ? [] : [col[c]!], ago, inbox });
}

// A few things still waiting in the Inbox.
await add("inbox1", {
  url: "https://github.com/tldraw/tldraw",
  title: "tldraw/tldraw",
  description: "A very good whiteboard SDK.",
  type: "repo",
  tags: ["open-source"],
  inbox: true,
  ago: 4 * DAY,
});
await add("inbox2", {
  url: "https://www.youtube.com/watch?v=local-first-talk",
  title: "Talk: the next ten years of local-first",
  type: "video",
  inbox: true,
  ago: 5 * DAY,
});

// Favorites and a highlight from the article (a quote card that links back to the passage).
await db
  .update(schema.saves)
  .set({ isFavorite: true })
  .where(
    sql`id IN (${sql.join(
      [ids.article!, ids.chair!, ids.book1!, ids.pasta!].map((i) => sql`${i}`),
      sql`, `,
    )})`,
  );
await saveHighlight(
  ids.article!,
  "A single database file can be copied, backed up, synced by any folder-sync tool and opened in twenty years by software that does not exist yet.",
);

/* ---------------------------------------------------------------- bookmarks */

const bookmarks: [string, string, string][] = [
  ["GitHub", "https://github.com/", "Dev tools"],
  ["MDN Web Docs", "https://developer.mozilla.org/", "Dev tools"],
  ["Can I use", "https://caniuse.com/", "Dev tools"],
  ["regex101", "https://regex101.com/", "Dev tools"],
  ["Excalidraw", "https://excalidraw.com/", "Design"],
  ["Figma", "https://www.figma.com/", "Design"],
  ["Coolors", "https://coolors.co/", "Design"],
  ["Hacker News", "https://news.ycombinator.com/", "Reading"],
  ["Lobsters", "https://lobste.rs/", "Reading"],
  ["Wikipedia", "https://en.wikipedia.org/", "Reading"],
  ["OpenStreetMap", "https://www.openstreetmap.org/", "Travel"],
  ["Rome2Rio", "https://www.rome2rio.com/", "Travel"],
];
const folderIds: Record<string, string> = {
  "Dev tools": col.dev!,
  Design: col.design!,
  Reading: col.reading!,
  Travel: col.travel!,
};
let opened = 0;
for (const [title, url, folder] of bookmarks) {
  const id = await add(`bm-${title}`, {
    url,
    title,
    bookmark: true,
    collectionIds: [folderIds[folder]!],
    ago: 60 * DAY,
  });
  await db
    .update(schema.saves)
    .set({ openCount: 20 - opened, lastOpenedAt: now - (opened++ + 1) * HOUR })
    .where(sql`id = ${id}`);
}

/* ---------------------------------------------------------------- a session */

const tabs: [string, string, string?][] = [
  ["https://www.rome2rio.com/", "Rome2Rio: discover how to get anywhere", "Japan trip"],
  ["https://en.wikipedia.org/wiki/Arashiyama", "Arashiyama — Wikipedia", "Japan trip"],
  ["https://en.wikipedia.org/wiki/Nara_Park", "Nara Park — Wikipedia", "Japan trip"],
  ["https://www.japan-guide.com/e/e2361.html", "Kyoto travel guide", "Japan trip"],
  ["https://sqlite.org/wal.html", "Write-Ahead Logging"],
  ["https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_Target_API", "Web Share Target API"],
  ["https://github.com/ollama/ollama/blob/main/docs/api.md", "ollama/docs/api.md"],
];
const sessionId = newId();
await db.transaction(async (tx) => {
  await tx.insert(schema.sessions).values({
    id: sessionId,
    name: "Friday research — trip + sqlite",
    notes: "Closed 7 tabs before the weekend.",
    browser: "chrome",
    tabCount: tabs.length,
    createdAt: now - 4 * DAY,
  });
  let position = 0;
  for (const [url, title, group] of tabs) {
    const r = await insertSave(
      tx,
      { url, title },
      {
        status: "active",
        captureMethod: "extension-session",
        metadataStatus: "none",
        createdAt: now - 4 * DAY,
      },
    );
    await tx.insert(schema.sessionItems).values({
      id: newId(),
      sessionId,
      saveId: r.id,
      position: position++,
      windowIndex: 0,
      url,
      title,
      pinned: position === 1,
      groupTitle: group ?? null,
      groupColor: group ? "red" : null,
    });
  }
});

await db.run(sql`UPDATE saves SET metadata_status = 'done' WHERE url IS NOT NULL`);
const [{ n } = { n: 0 }] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM saves`);
fs.writeFileSync(path.join(dataDir, "demo.json"), JSON.stringify(ids));
console.log(`Demo library ready in ${dataDir}: ${n} saves.`);
process.exit(0);
