import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  detectType,
  domainOf,
  normalizeTag,
  normalizeUrl,
  parseQuery,
  repoInfo,
  smartRules,
  stripTracking,
  titleFromUrl,
  paletteNames,
  sanitizeFacts,
  interpretQuery,
  quoteTitle,
  textFragmentUrl,
  type CaptureMethod,
  type Facts,
  type PaletteColor,
  type CreateSaveInput,
  type SaveType,
  type UpdateSaveInput,
} from "@tymo/core";
import { readingMinutes, type ReaderContent } from "@tymo/core/reader";
import { getDb, schema, type Executor } from "./db";
import { newId } from "./ids";
import { ftsMatch, queryFiltersSql, reindexSave, removeFromIndex, rulesSql } from "./search";
import { deleteStoredFiles } from "./files";
import { forgetEmbeddings, semanticSearch, similarTo } from "./embeddings";

const { saves, tags, saveTags, saveCollections, collections, files, sessionItems, sessions } =
  schema;

export interface SaveView {
  id: string;
  type: SaveType;
  status: "inbox" | "active";
  url: string | null;
  title: string;
  description: string | null;
  domain: string | null;
  faviconUrl: string | null;
  imageUrl: string | null;
  notes: string | null;
  excerpt: string | null;
  isFavorite: boolean;
  isArchived: boolean;
  isBookmark: boolean;
  createdAt: number;
  lastOpenedAt: number | null;
  /** Hidden from the inbox until this time; null when not snoozed. */
  snoozedUntil: number | null;
  /** Estimated reading time in minutes for pages with enough text (≥ 1 min), else null. */
  readMinutes: number | null;
  /** Result of the last link check, when it found a problem. */
  linkStatus: "broken" | "moved" | null;
  metadataStatus: string;
  fileId: string | null;
  fileMime: string | null;
  tags: string[];
  collections: { id: string; name: string; icon: string | null }[];
  /** Set on search results found by meaning only (no keyword match). */
  semantic?: boolean;
  /** Dominant colours of the preview image (null until measured). */
  colors: string[] | null;
  /** Structured details for rich cards (recipe time, price, year…). */
  facts: Facts | null;
}

export interface SaveDetail extends SaveView {
  body: string | null;
  aiSummary: string | null;
  extractedTextLength: number;
  /** Text read from an image (OCR), shown in the detail panel for image saves. */
  imageText: string | null;
  captureMethod: string;
  source: string | null;
  metadata: Record<string, unknown> | null;
  updatedAt: number;
  openCount: number;
  sessions: { id: string; name: string }[];
  files: { id: string; kind: string; mime: string; size: number }[];
}

type CreateOptions = {
  status?: "inbox" | "active";
  captureMethod?: CaptureMethod;
  metadataStatus?: "none" | "pending" | "done" | "failed";
  extractedText?: string;
  createdAt?: number;
  /** Merge into an existing save with the same normalized URL instead of creating a duplicate. */
  dedupe?: boolean;
};

export type CreateResult = { id: string; duplicate: boolean; needsEnrichment: boolean };

/* ------------------------------------------------------------------ tags */

async function ensureTagIds(db: Executor, names: string[]): Promise<string[]> {
  const clean = [...new Set(names.map(normalizeTag).filter(Boolean))];
  if (!clean.length) return [];
  await db
    .insert(tags)
    .values(clean.map((name) => ({ id: newId(), name })))
    .onConflictDoNothing();
  const rows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.name, clean));
  return rows.map((r) => r.id);
}

async function setTags(db: Executor, saveId: string, names: string[]) {
  await db.delete(saveTags).where(eq(saveTags.saveId, saveId));
  const ids = await ensureTagIds(db, names);
  if (ids.length)
    await db
      .insert(saveTags)
      .values(ids.map((tagId) => ({ saveId, tagId })))
      .onConflictDoNothing();
}

async function addTags(db: Executor, saveId: string, names: string[]) {
  const ids = await ensureTagIds(db, names);
  if (ids.length)
    await db
      .insert(saveTags)
      .values(ids.map((tagId) => ({ saveId, tagId })))
      .onConflictDoNothing();
}

async function existingCollectionIds(db: Executor, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: collections.id })
    .from(collections)
    .where(inArray(collections.id, ids));
  return rows.map((r) => r.id);
}

async function setCollections(db: Executor, saveId: string, ids: string[]) {
  await db.delete(saveCollections).where(eq(saveCollections.saveId, saveId));
  const valid = await existingCollectionIds(db, ids);
  if (valid.length) {
    await db
      .insert(saveCollections)
      .values(valid.map((collectionId) => ({ saveId, collectionId })))
      .onConflictDoNothing();
  }
  return valid;
}

/* ---------------------------------------------------------------- create */

export async function findByUrl(db: Executor, url: string) {
  const norm = normalizeUrl(url);
  if (!norm) return null;
  const [row] = await db
    .select({ id: saves.id })
    .from(saves)
    .where(eq(saves.normalizedUrl, norm))
    .orderBy(saves.createdAt)
    .limit(1);
  return row ?? null;
}

/** Inserts one save inside an existing transaction. */
export async function insertSave(
  db: Executor,
  input: CreateSaveInput,
  opts: CreateOptions = {},
): Promise<CreateResult> {
  const url = input.url ? stripTracking(input.url) : undefined;
  const collectionIds = input.collectionIds ?? [];

  // A quote points at its source page but is its own thing: never merged into (or found as)
  // the page save, so it has no normalized URL.
  const isQuote = input.type === "quote";
  if (url && opts.dedupe !== false && !isQuote) {
    const existing = await findByUrl(db, url);
    if (existing) {
      if (input.tags?.length) await addTags(db, existing.id, input.tags);
      const valid = await existingCollectionIds(db, collectionIds);
      if (valid.length) {
        await db
          .insert(saveCollections)
          .values(valid.map((collectionId) => ({ saveId: existing.id, collectionId })))
          .onConflictDoNothing();
      }
      const patch: Partial<typeof saves.$inferInsert> = {
        updatedAt: Date.now(),
        isArchived: false,
      };
      const [cur] = await db
        .select({
          notes: saves.notes,
          title: saves.title,
          url: saves.url,
          faviconUrl: saves.faviconUrl,
        })
        .from(saves)
        .where(eq(saves.id, existing.id));
      if (input.notes?.trim()) {
        patch.notes = cur?.notes ? `${cur.notes}\n\n${input.notes.trim()}` : input.notes.trim();
      }
      // Upgrade placeholder titles/icons with what the client knows (e.g. a real tab title).
      if (
        cur &&
        input.title?.trim() &&
        (cur.title === cur.url || cur.title === titleFromUrl(cur.url ?? ""))
      ) {
        patch.title = input.title.trim();
      }
      if (cur && !cur.faviconUrl && input.faviconUrl) patch.faviconUrl = input.faviconUrl;
      if (valid.length) patch.status = "active";
      if (input.bookmark) {
        patch.isBookmark = true;
        patch.status = "active";
      }
      await db.update(saves).set(patch).where(eq(saves.id, existing.id));
      await reindexSave(db, existing.id);
      return { id: existing.id, duplicate: true, needsEnrichment: false };
    }
  }

  const id = newId();
  const type: SaveType = input.type ?? (url ? detectType(url) : "note");
  const title =
    input.title?.trim() ||
    (url
      ? titleFromUrl(url)
      : (input.body ?? "").trim().split("\n")[0]!.slice(0, 120) || "Untitled");
  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
  if (type === "repo" && url) Object.assign(metadata, repoInfo(url) ?? {});
  if (type === "quote") {
    // Lets the reader find highlights of a page, whichever client saved them.
    const src = typeof metadata.sourceUrl === "string" ? metadata.sourceUrl : url;
    const key = src ? normalizeUrl(src) : null;
    if (key) metadata.sourceKey = key;
    else delete metadata.sourceKey;
  }
  const needsEnrichment =
    !!url &&
    opts.metadataStatus !== "none" &&
    [
      "link",
      "article",
      "repo",
      "video",
      "social",
      "tool",
      "place",
      "recipe",
      "book",
      "movie",
      "product",
    ].includes(type);
  const now = Date.now();

  const [{ next } = { next: 1 }] = await db.all<{ next: number }>(
    sql`SELECT coalesce(max(seq), 0) + 1 AS next FROM saves`,
  );
  await db.insert(saves).values({
    id,
    seq: next,
    type,
    // Bookmarks and filed saves skip the Inbox.
    status: opts.status ?? (collectionIds.length || input.bookmark ? "active" : "inbox"),
    url: url ?? null,
    normalizedUrl: url && !isQuote ? normalizeUrl(url) : null,
    title,
    description: input.description?.trim() || null,
    domain: domainOf(url),
    faviconUrl: input.faviconUrl ?? null,
    imageUrl: input.imageUrl ?? null,
    notes: input.notes?.trim() || null,
    body: input.body ?? null,
    extractedText: opts.extractedText ?? null,
    isFavorite: input.favorite ?? false,
    isBookmark: input.bookmark ?? false,
    captureMethod: opts.captureMethod ?? input.captureMethod ?? "web",
    source: input.source ?? null,
    metadata: Object.keys(metadata).length ? metadata : null,
    metadataStatus: needsEnrichment ? "pending" : "none",
    createdAt: opts.createdAt ?? now,
    updatedAt: now,
  });
  if (input.tags?.length) await addTags(db, id, input.tags);
  if (collectionIds.length) await setCollections(db, id, collectionIds);
  await reindexSave(db, id);
  return { id, duplicate: false, needsEnrichment };
}

export async function createSave(
  input: CreateSaveInput,
  opts: CreateOptions = {},
): Promise<CreateResult> {
  const db = await getDb();
  return db.transaction(async (tx) => insertSave(tx, input, opts), { behavior: "immediate" });
}

/* ---------------------------------------------------------------- update */

export async function updateSave(id: string, input: UpdateSaveInput) {
  const db = await getDb();
  await db.transaction(
    async (tx) => {
      const patch: Partial<typeof saves.$inferInsert> = { updatedAt: Date.now() };
      if (input.title !== undefined) patch.title = input.title || "Untitled";
      if (input.description !== undefined) patch.description = input.description || null;
      if (input.notes !== undefined) patch.notes = input.notes?.trim() ? input.notes : null;
      if (input.body !== undefined) patch.body = input.body;
      if (input.type !== undefined) patch.type = input.type;
      if (input.favorite !== undefined) patch.isFavorite = input.favorite;
      if (input.bookmark !== undefined) patch.isBookmark = input.bookmark;
      if (input.archived !== undefined) patch.isArchived = input.archived;
      if (input.status !== undefined) patch.status = input.status;
      if (input.metadata !== undefined) patch.metadata = input.metadata;
      if (input.url !== undefined) {
        patch.url = input.url;
        const [cur] = await tx.select({ type: saves.type }).from(saves).where(eq(saves.id, id));
        const type = input.type ?? cur?.type;
        patch.normalizedUrl = input.url && type !== "quote" ? normalizeUrl(input.url) : null;
        patch.domain = domainOf(input.url);
      }
      if (input.tags) await setTags(tx, id, input.tags);
      if (input.collectionIds) {
        const valid = await setCollections(tx, id, input.collectionIds);
        if (valid.length && input.status === undefined) patch.status = "active";
      }
      await tx.update(saves).set(patch).where(eq(saves.id, id));
      await reindexSave(tx, id);
    },
    { behavior: "immediate" },
  );
}

/** Saves that are not currently snoozed. */
export function notSnoozed(now = Date.now()): SQL {
  return sql`(s.snoozed_until IS NULL OR s.snoozed_until <= ${now})`;
}

export type BulkAction =
  | {
      kind:
        | "archive"
        | "unarchive"
        | "favorite"
        | "unfavorite"
        | "bookmark"
        | "unbookmark"
        | "done"
        | "inbox"
        | "delete";
    }
  | { kind: "snooze"; until: number | null }
  | { kind: "addTag" | "removeTag"; tag: string }
  | { kind: "addToCollection" | "removeFromCollection"; collectionId: string };

export async function bulkUpdate(ids: string[], action: BulkAction) {
  if (!ids.length) return;
  if (action.kind === "delete") return deleteSaves(ids);
  const db = await getDb();
  await db.transaction(
    async (tx) => {
      const now = Date.now();
      const set = (patch: Partial<typeof saves.$inferInsert>) =>
        tx
          .update(saves)
          .set({ ...patch, updatedAt: now })
          .where(inArray(saves.id, ids));
      switch (action.kind) {
        case "archive":
          await set({ isArchived: true, status: "active", snoozedUntil: null });
          break;
        case "unarchive":
          await set({ isArchived: false });
          break;
        case "favorite":
          await set({ isFavorite: true });
          break;
        case "unfavorite":
          await set({ isFavorite: false });
          break;
        case "bookmark":
          // A bookmark is filed by definition: it leaves the Inbox.
          await set({ isBookmark: true, status: "active", snoozedUntil: null });
          break;
        case "unbookmark":
          await set({ isBookmark: false });
          break;
        case "done":
          await set({ status: "active", snoozedUntil: null });
          break;
        case "inbox":
          await set({ status: "inbox", isArchived: false, snoozedUntil: null });
          break;
        case "snooze":
          // Snoozing keeps (or puts) the save in the inbox; it reappears when the time comes.
          await set(
            action.until
              ? { snoozedUntil: action.until, status: "inbox", isArchived: false }
              : { snoozedUntil: null },
          );
          break;
        case "addTag": {
          const [tagId] = await ensureTagIds(tx, [action.tag]);
          if (tagId)
            await tx
              .insert(saveTags)
              .values(ids.map((saveId) => ({ saveId, tagId })))
              .onConflictDoNothing();
          break;
        }
        case "removeTag": {
          const [row] = await tx
            .select({ id: tags.id })
            .from(tags)
            .where(eq(tags.name, normalizeTag(action.tag)));
          if (row)
            await tx
              .delete(saveTags)
              .where(and(eq(saveTags.tagId, row.id), inArray(saveTags.saveId, ids)));
          break;
        }
        case "addToCollection": {
          const [valid] = await existingCollectionIds(tx, [action.collectionId]);
          if (valid) {
            await tx
              .insert(saveCollections)
              .values(ids.map((saveId) => ({ saveId, collectionId: valid })))
              .onConflictDoNothing();
            await set({ status: "active" });
          }
          break;
        }
        case "removeFromCollection":
          await tx
            .delete(saveCollections)
            .where(
              and(
                eq(saveCollections.collectionId, action.collectionId),
                inArray(saveCollections.saveId, ids),
              ),
            );
          break;
      }
      if (
        ["addTag", "removeTag", "addToCollection", "removeFromCollection"].includes(action.kind)
      ) {
        for (const id of ids) await reindexSave(tx, id);
      }
    },
    { behavior: "immediate" },
  );
}

export async function deleteSaves(ids: string[]) {
  const db = await getDb();
  const keys = await db.transaction(
    async (tx) => {
      const rows = await tx.select({ seq: saves.seq }).from(saves).where(inArray(saves.id, ids));
      const fileRows = await tx
        .select({ key: files.storageKey })
        .from(files)
        .where(inArray(files.saveId, ids));
      await removeFromIndex(
        tx,
        rows.map((r) => r.seq),
      );
      await tx.delete(saves).where(inArray(saves.id, ids));
      return fileRows.map((f) => f.key);
    },
    { behavior: "immediate" },
  );
  forgetEmbeddings(ids);
  await deleteStoredFiles(keys);
}

/**
 * Merges `dropId` into `keepId`: tags, manual collections, session references and files
 * move over; notes are appended; favourite/open stats combine. Then `dropId` is deleted.
 */
export async function mergeSaves(keepId: string, dropId: string) {
  if (keepId === dropId) throw new Error("Can't merge a save into itself");
  const db = await getDb();
  await db.transaction(
    async (tx) => {
      const rows = await tx
        .select()
        .from(saves)
        .where(inArray(saves.id, [keepId, dropId]));
      const keep = rows.find((r) => r.id === keepId);
      const drop = rows.find((r) => r.id === dropId);
      if (!keep || !drop) throw new Error("Save not found");
      await tx.run(sql`INSERT OR IGNORE INTO save_tags (save_id, tag_id)
        SELECT ${keepId}, tag_id FROM save_tags WHERE save_id = ${dropId}`);
      await tx.run(sql`INSERT OR IGNORE INTO save_collections (save_id, collection_id, added_at)
        SELECT ${keepId}, collection_id, added_at FROM save_collections WHERE save_id = ${dropId}`);
      await tx.update(sessionItems).set({ saveId: keepId }).where(eq(sessionItems.saveId, dropId));
      await tx.update(files).set({ saveId: keepId }).where(eq(files.saveId, dropId));
      const notes =
        drop.notes && !(keep.notes ?? "").includes(drop.notes)
          ? [keep.notes, drop.notes].filter(Boolean).join("\n\n")
          : keep.notes;
      await tx
        .update(saves)
        .set({
          notes,
          description: keep.description ?? drop.description,
          faviconUrl: keep.faviconUrl ?? drop.faviconUrl,
          imageUrl: keep.imageUrl ?? drop.imageUrl,
          body: keep.body ?? drop.body,
          extractedText: keep.extractedText ?? drop.extractedText,
          reader: keep.reader ?? drop.reader,
          aiSummary: keep.aiSummary ?? drop.aiSummary,
          isFavorite: keep.isFavorite || drop.isFavorite,
          isBookmark: keep.isBookmark || drop.isBookmark,
          isArchived: keep.isArchived && drop.isArchived,
          status: keep.status === "active" || drop.status === "active" ? "active" : "inbox",
          openCount: keep.openCount + drop.openCount,
          lastOpenedAt: Math.max(keep.lastOpenedAt ?? 0, drop.lastOpenedAt ?? 0) || null,
          createdAt: Math.min(keep.createdAt, drop.createdAt),
          updatedAt: Date.now(),
        })
        .where(eq(saves.id, keepId));
      await removeFromIndex(tx, [drop.seq]);
      await tx.delete(saves).where(eq(saves.id, dropId));
      await reindexSave(tx, keepId);
    },
    { behavior: "immediate" },
  );
  forgetEmbeddings([dropId]);
}

export async function markOpened(id: string) {
  const db = await getDb();
  await db
    .update(saves)
    .set({ lastOpenedAt: Date.now(), openCount: sql`${saves.openCount} + 1` })
    .where(eq(saves.id, id));
}

/* ------------------------------------------------------------------ read */

export type ListView = "all" | "inbox" | "favorites" | "archive";
export type SortKey = "newest" | "oldest" | "title" | "opened" | "relevance";

export interface ListParams {
  view?: ListView;
  collectionId?: string;
  sessionId?: string;
  q?: string;
  sort?: SortKey;
  offset?: number;
  limit?: number;
  /** Blend in semantic (embedding) matches for free-text queries when available. Default true. */
  semantic?: boolean;
  /** Read sentence-like queries as natural language ("articles from last week"). Default false. */
  natural?: boolean;
}

export interface ListResult {
  items: SaveView[];
  total: number;
  hasMore: boolean;
  /** The query actually run, when a natural-language query was rewritten. */
  interpreted?: string;
}

const SAVE_COLUMNS = sql`s.id, s.type, s.status, s.url, s.title, s.description, s.domain, s.favicon_url, s.image_url,
  s.notes, substr(s.body, 1, 280) AS excerpt, s.is_favorite, s.is_archived, s.is_bookmark, s.created_at, s.last_opened_at, s.snoozed_until, s.metadata_status,
  json_extract(s.metadata, '$.linkCheck.status') AS link_status,
  length(coalesce(s.extracted_text, s.body, '')) AS text_len,
  json_extract(s.metadata, '$.words') AS words,
  json_extract(s.metadata, '$.colors') AS colors_json,
  json_extract(s.metadata, '$.facts') AS facts_json,
  (SELECT f.id FROM files f WHERE f.save_id = s.id AND f.kind != 'snapshot' ORDER BY f.created_at LIMIT 1) AS file_id,
  (SELECT f.mime FROM files f WHERE f.save_id = s.id AND f.kind != 'snapshot' ORDER BY f.created_at LIMIT 1) AS file_mime`;

type SaveRowRaw = {
  id: string;
  type: SaveType;
  status: "inbox" | "active";
  url: string | null;
  title: string;
  description: string | null;
  domain: string | null;
  favicon_url: string | null;
  image_url: string | null;
  notes: string | null;
  excerpt: string | null;
  is_favorite: number;
  is_archived: number;
  is_bookmark: number;
  created_at: number;
  last_opened_at: number | null;
  snoozed_until: number | null;
  link_status: string | null;
  text_len: number;
  words: number | null;
  colors_json: string | null;
  facts_json: string | null;
  metadata_status: string;
  file_id: string | null;
  file_mime: string | null;
};

/**
 * Reading time for text-heavy types: the reader view's word count when known (≈230 wpm, same
 * as the reader page), else ~1,100 characters per minute of extracted text.
 */
export function readMinutes(type: string, chars: number, words?: number | null): number | null {
  if (!["article", "link", "note", "snippet", "pdf"].includes(type)) return null;
  if (typeof words === "number" && words > 0) return words < 250 ? null : readingMinutes(words);
  if (chars < 1500) return null;
  return Math.max(1, Math.round(chars / 1100));
}

function parseJson<T>(raw: string | null, ok: (v: unknown) => v is T): T | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return ok(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Stores dominant colours measured by the browser (it decodes the image anyway). Hex codes
 * are validated by the caller; names are derived here so search can't be fed arbitrary tags.
 */
export async function setSaveColors(items: { id: string; colors: PaletteColor[] }[]) {
  const db = await getDb();
  for (const { id, colors } of items) {
    const hex = colors.map((c) => c.hex);
    await db.run(sql`UPDATE saves SET metadata = json_set(coalesce(metadata, '{}'),
      '$.colors', json(${JSON.stringify(hex)}),
      '$.colorNames', json(${JSON.stringify(paletteNames(colors))}))
      WHERE id = ${id}`);
  }
}

async function hydrate(db: Executor, rows: SaveRowRaw[]): Promise<SaveView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const idList = sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );
  const tagRows = await db.all<{ save_id: string; name: string }>(
    sql`SELECT st.save_id, t.name FROM save_tags st JOIN tags t ON t.id = st.tag_id WHERE st.save_id IN (${idList}) ORDER BY t.name`,
  );
  const colRows = await db.all<{ save_id: string; id: string; name: string; icon: string | null }>(
    sql`SELECT sc.save_id, c.id, c.name, c.icon FROM save_collections sc JOIN collections c ON c.id = sc.collection_id
        WHERE sc.save_id IN (${idList}) ORDER BY c.name`,
  );
  const tagMap = new Map<string, string[]>();
  for (const t of tagRows)
    (tagMap.get(t.save_id) ?? tagMap.set(t.save_id, []).get(t.save_id)!).push(t.name);
  const colMap = new Map<string, SaveView["collections"]>();
  for (const c of colRows) {
    (colMap.get(c.save_id) ?? colMap.set(c.save_id, []).get(c.save_id)!).push({
      id: c.id,
      name: c.name,
      icon: c.icon,
    });
  }
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    url: r.url,
    title: r.title,
    description: r.description,
    domain: r.domain,
    faviconUrl: r.favicon_url,
    imageUrl: r.image_url,
    notes: r.notes,
    excerpt: r.excerpt,
    isFavorite: !!r.is_favorite,
    isArchived: !!r.is_archived,
    isBookmark: !!r.is_bookmark,
    createdAt: r.created_at,
    lastOpenedAt: r.last_opened_at,
    snoozedUntil: r.snoozed_until && r.snoozed_until > Date.now() ? r.snoozed_until : null,
    readMinutes: readMinutes(r.type, r.text_len, r.words),
    linkStatus: r.link_status === "broken" || r.link_status === "moved" ? r.link_status : null,
    metadataStatus: r.metadata_status,
    fileId: r.file_id,
    fileMime: r.file_mime,
    tags: tagMap.get(r.id) ?? [],
    collections: colMap.get(r.id) ?? [],
    // Metadata is also writable through the API: only well-formed values reach the UI.
    colors:
      parseJson(r.colors_json, (v): v is unknown[] => Array.isArray(v))
        ?.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c))
        .slice(0, 8) ?? null,
    facts: sanitizeFacts(parseJson(r.facts_json, (v): v is unknown => v !== null)),
  }));
}

export async function collectionFilterSql(db: Executor, collectionId: string): Promise<SQL> {
  const [col] = await db.select().from(collections).where(eq(collections.id, collectionId));
  if (!col) return sql`0`;
  const manual = sql`s.id IN (SELECT save_id FROM save_collections WHERE collection_id = ${collectionId})`;
  const parsed = col.smartRules ? smartRules.safeParse(col.smartRules) : null;
  return parsed?.success ? sql`(${manual} OR ${rulesSql(parsed.data)})` : manual;
}

export async function listSaves(params: ListParams): Promise<ListResult> {
  if (!params.natural || !params.q) return listSavesExact(params);
  const interp = interpretQuery(params.q);
  if (!interp.changed) return listSavesExact(params);
  const res = await listSavesExact({ ...params, q: interp.query });
  return { ...res, interpreted: interp.query };
}

async function listSavesExact(
  params: ListParams,
): Promise<{ items: SaveView[]; total: number; hasMore: boolean }> {
  const db = await getDb();
  const limit = Math.min(Math.max(params.limit ?? 60, 1), 200);
  const offset = Math.max(params.offset ?? 0, 0);
  const view = params.view ?? "all";
  const parsed = parseQuery(params.q ?? "");
  const match = ftsMatch(parsed);

  const where: SQL[] = [];
  if (view === "archive" || parsed.archived) where.push(sql`s.is_archived = 1`);
  else where.push(sql`s.is_archived = 0`);
  if (view === "inbox") {
    where.push(sql`s.status = 'inbox'`);
    if (!parsed.snoozed) where.push(notSnoozed());
  }
  if (view === "favorites") where.push(sql`s.is_favorite = 1`);
  if (params.collectionId) where.push(await collectionFilterSql(db, params.collectionId));
  if (params.sessionId) {
    where.push(
      sql`s.id IN (SELECT save_id FROM session_items WHERE session_id = ${params.sessionId})`,
    );
  }
  where.push(...queryFiltersSql(parsed));

  const from = match
    ? sql`FROM saves s JOIN (SELECT rowid AS seq, bm25(saves_fts, 10.0, 4.0, 3.0, 6.0, 3.0, 1.0) AS rank
                           FROM saves_fts WHERE saves_fts MATCH ${match}) f ON f.seq = s.seq`
    : sql`FROM saves s`;
  const whereSql = sql`WHERE ${sql.join(where, sql` AND `)}`;
  const sort = params.sort ?? (match ? "relevance" : "newest");
  const order =
    sort === "relevance" && match
      ? sql`ORDER BY f.rank, s.created_at DESC`
      : sort === "oldest"
        ? sql`ORDER BY s.created_at ASC`
        : sort === "title"
          ? sql`ORDER BY s.title COLLATE NOCASE ASC`
          : sort === "opened"
            ? sql`ORDER BY s.last_opened_at IS NULL, s.last_opened_at DESC, s.created_at DESC`
            : sql`ORDER BY s.created_at DESC`;

  if (match && sort === "relevance" && params.semantic !== false) {
    const sem = await semanticSearch([...parsed.phrases, ...parsed.terms].join(" "));
    if (sem?.length) {
      return hybridList(db, { from, where, sem, excluded: parsed.excluded, limit, offset });
    }
  }

  try {
    const rows = await db.all<SaveRowRaw>(
      sql`SELECT ${SAVE_COLUMNS} ${from} ${whereSql} ${order} LIMIT ${limit + 1} OFFSET ${offset}`,
    );
    const [{ n } = { n: 0 }] = await db.all<{ n: number }>(
      sql`SELECT count(*) AS n ${from} ${whereSql}`,
    );
    const hasMore = rows.length > limit;
    return { items: await hydrate(db, rows.slice(0, limit)), total: n, hasMore };
  } catch (err) {
    // A malformed FTS expression should never 500 the page.
    if (String(err).includes("fts5")) return { items: [], total: 0, hasMore: false };
    throw err;
  }
}

async function rowsByIds(db: Executor, ids: string[]): Promise<SaveRowRaw[]> {
  if (!ids.length) return [];
  const rows = await db.all<SaveRowRaw>(
    sql`SELECT ${SAVE_COLUMNS} FROM saves s WHERE s.id IN (${sql.join(
      ids.map((i) => sql`${i}`),
      sql`, `,
    )})`,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((i) => byId.get(i)).filter((r): r is SaveRowRaw => !!r);
}

/** Saves by id, in the given order (missing ids are skipped). */
export async function getSavesByIds(ids: string[]): Promise<SaveView[]> {
  const db = await getDb();
  return hydrate(db, await rowsByIds(db, ids));
}

/**
 * Keyword (FTS/BM25) and semantic (embedding) results fused with Reciprocal Rank Fusion.
 * Both lists honour the same filters; keyword matches get a slightly higher weight.
 */
async function hybridList(
  db: Executor,
  o: {
    from: SQL;
    where: SQL[];
    sem: { id: string; score: number }[];
    excluded: string[];
    limit: number;
    offset: number;
  },
): Promise<{ items: SaveView[]; total: number; hasMore: boolean }> {
  const K = 60;
  let ftsIds: string[] = [];
  try {
    const rows = await db.all<{ id: string }>(
      sql`SELECT s.id ${o.from} WHERE ${sql.join(o.where, sql` AND `)} ORDER BY f.rank LIMIT 500`,
    );
    ftsIds = rows.map((r) => r.id);
  } catch (err) {
    if (!String(err).includes("fts5")) throw err;
  }
  const semWhere = [
    ...o.where,
    sql`s.id IN (${sql.join(
      o.sem.map((h) => sql`${h.id}`),
      sql`, `,
    )})`,
    ...o.excluded.map(
      (ex) =>
        sql`(s.title || ' ' || coalesce(s.description, '')) NOT LIKE ${"%" + ex.replace(/[\\%_]/g, (c) => "\\" + c) + "%"} ESCAPE '\\'`,
    ),
  ];
  const allowed = new Set(
    (
      await db.all<{ id: string }>(
        sql`SELECT s.id FROM saves s WHERE ${sql.join(semWhere, sql` AND `)}`,
      )
    ).map((r) => r.id),
  );
  const score = new Map<string, number>();
  ftsIds.forEach((id, i) => score.set(id, 1 / (K + i)));
  o.sem
    .filter((h) => allowed.has(h.id))
    .forEach((h, i) => score.set(h.id, (score.get(h.id) ?? 0) + 0.8 / (K + i)));
  const ordered = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const page = ordered.slice(o.offset, o.offset + o.limit);
  const keyword = new Set(ftsIds);
  const items = await hydrate(db, await rowsByIds(db, page));
  for (const it of items) if (!keyword.has(it.id)) it.semantic = true;
  return { items, total: ordered.length, hasMore: o.offset + o.limit < ordered.length };
}

/**
 * Saves related to the given one: nearest by embedding when available, otherwise a
 * keyword match on its title and tags (so the panel works without AI).
 */
export async function relatedSaves(id: string, limit = 6): Promise<SaveView[]> {
  const db = await getDb();
  const sim = await similarTo(id, limit * 2);
  let ids: string[];
  if (sim?.length) {
    ids = sim.map((h) => h.id);
  } else {
    const [row] = await db.all<{ seq: number; title: string; tags: string | null }>(
      sql`SELECT s.seq, s.title, (SELECT group_concat(t.name, ' ') FROM save_tags st JOIN tags t ON t.id = st.tag_id WHERE st.save_id = s.id) AS tags
          FROM saves s WHERE s.id = ${id}`,
    );
    if (!row) return [];
    const words = [
      ...new Set(
        `${row.title} ${row.tags ?? ""}`
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
      ),
    ].slice(0, 12);
    // Words that appear in lots of saves ("note", "github") say nothing about relatedness.
    const [{ total } = { total: 0 }] = await db.all<{ total: number }>(
      sql`SELECT count(*) AS total FROM saves`,
    );
    const maxDf = Math.max(3, Math.floor(total * 0.08));
    const distinctive: string[] = [];
    for (const w of words) {
      try {
        const [{ n } = { n: 0 }] = await db.all<{ n: number }>(
          sql`SELECT count(*) AS n FROM saves_fts WHERE saves_fts MATCH ${`"${w}"`}`,
        );
        if (n > 1 && n <= maxDf) distinctive.push(w);
      } catch {
        /* odd token: skip */
      }
    }
    if (!distinctive.length) return [];
    const match = distinctive.map((w) => `"${w}"`).join(" OR ");
    try {
      const rows = await db.all<{ id: string }>(
        sql`SELECT s.id FROM saves s JOIN (SELECT rowid AS seq, bm25(saves_fts, 10.0, 4.0, 3.0, 6.0, 3.0, 1.0) AS rank
              FROM saves_fts WHERE saves_fts MATCH ${match}) f ON f.seq = s.seq
            WHERE s.seq != ${row.seq} ORDER BY f.rank LIMIT ${limit * 2}`,
      );
      ids = rows.map((r) => r.id);
    } catch {
      return [];
    }
  }
  const rows = (await rowsByIds(db, ids)).filter((r) => !r.is_archived).slice(0, limit);
  return hydrate(db, rows);
}

const STOPWORDS = new Set(
  "about after also been before being could does from have here into just like more most much only other over same should some such than that their them then there these they this those through very what when where which while with would your www.com http https".split(
    " ",
  ),
);

export async function getSave(id: string): Promise<SaveDetail | null> {
  const db = await getDb();
  const rows = await db.all<SaveRowRaw>(
    sql`SELECT ${SAVE_COLUMNS} FROM saves s WHERE s.id = ${id}`,
  );
  const [view] = await hydrate(db, rows);
  if (!view) return null;
  const [full] = await db.select().from(saves).where(eq(saves.id, id));
  const sess = await db
    .selectDistinct({ id: sessions.id, name: sessions.name })
    .from(sessionItems)
    .innerJoin(sessions, eq(sessions.id, sessionItems.sessionId))
    .where(eq(sessionItems.saveId, id));
  const fileRows = await db
    .select({ id: files.id, kind: files.kind, mime: files.mime, size: files.size })
    .from(files)
    .where(eq(files.saveId, id));
  return {
    ...view,
    body: full!.body,
    aiSummary: full!.aiSummary,
    extractedTextLength: full!.extractedText?.length ?? 0,
    imageText: ["image", "screenshot"].includes(full!.type)
      ? (full!.extractedText?.slice(0, 5000) ?? null)
      : null,
    captureMethod: full!.captureMethod,
    source: full!.source,
    metadata: full!.metadata ?? null,
    updatedAt: full!.updatedAt,
    openCount: full!.openCount,
    sessions: sess,
    files: fileRows,
  };
}

export interface ReaderView {
  id: string;
  type: SaveType;
  title: string;
  url: string | null;
  domain: string | null;
  faviconUrl: string | null;
  imageUrl: string | null;
  description: string | null;
  body: string | null;
  notes: string | null;
  metadataStatus: string;
  author: string | null;
  siteName: string | null;
  publishedAt: string | null;
  reader: ReaderContent | null;
  /** Plain extracted text, used when there is no structured article. */
  text: string | null;
  snapshotId: string | null;
  createdAt: number;
}

/** Everything the reader page needs for one save (the article blocks are only loaded here). */
export async function getReaderView(id: string): Promise<ReaderView | null> {
  const db = await getDb();
  const [row] = await db.select().from(saves).where(eq(saves.id, id));
  if (!row) return null;
  const [snap] = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.saveId, id), eq(files.kind, "snapshot")))
    .limit(1);
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    id: row.id,
    type: row.type as SaveType,
    title: row.title,
    url: row.url,
    domain: row.domain,
    faviconUrl: row.faviconUrl,
    imageUrl: row.imageUrl,
    description: row.description,
    body: row.body,
    notes: row.notes,
    metadataStatus: row.metadataStatus,
    author: str(meta.author),
    siteName: str(meta.siteName),
    publishedAt: str(meta.publishedAt),
    reader: row.reader?.v === 1 ? row.reader : null,
    text: ["image", "screenshot"].includes(row.type)
      ? null
      : (row.extractedText?.slice(0, 50_000) ?? null),
    snapshotId: snap?.id ?? null,
    createdAt: row.createdAt,
  };
}

/** Saves a passage of a page as a quote card linked back to the exact spot. */
export async function saveHighlight(sourceId: string, text: string): Promise<CreateResult> {
  const db = await getDb();
  const [src] = await db
    .select({ url: saves.url, title: saves.title, faviconUrl: saves.faviconUrl })
    .from(saves)
    .where(eq(saves.id, sourceId));
  if (!src) throw new Error("Save not found");
  const body = text.trim().slice(0, 20_000);
  if (!body) throw new Error("Select some text to highlight");
  return createSave(
    {
      type: "quote",
      title: quoteTitle(body),
      body,
      url: src.url ? textFragmentUrl(src.url, body) : undefined,
      faviconUrl: src.faviconUrl ?? undefined,
      metadata: { sourceSaveId: sourceId, sourceUrl: src.url, sourceTitle: src.title },
    },
    // Taken while reading, so already "processed": it skips the Inbox.
    { captureMethod: "web", status: "active" },
  );
}

/** Highlights (quote saves) taken from a page, oldest first. */
export async function highlightsFor(saveId: string): Promise<{ id: string; text: string }[]> {
  const db = await getDb();
  const [src] = await db
    .select({ key: saves.normalizedUrl })
    .from(saves)
    .where(eq(saves.id, saveId));
  if (!src) return [];
  const rows = await db.all<{ id: string; body: string | null }>(
    sql`SELECT s.id, s.body FROM saves s WHERE s.type = 'quote' AND s.is_archived = 0 AND (
          json_extract(s.metadata, '$.sourceSaveId') = ${saveId}
          ${src.key ? sql`OR json_extract(s.metadata, '$.sourceKey') = ${src.key}` : sql``})
        ORDER BY s.created_at LIMIT 200`,
  );
  return rows.filter((r) => r.body?.trim()).map((r) => ({ id: r.id, text: r.body! }));
}

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  domain: string | null;
  faviconUrl: string | null;
  folder: { id: string; name: string; icon: string | null } | null;
  openCount: number;
  lastOpenedAt: number | null;
  createdAt: number;
}

/** Everything on the Bookmarks page (a launcher: small rows, no text). */
export async function listBookmarks(limit = 5000): Promise<BookmarkItem[]> {
  const db = await getDb();
  const rows = await db.all<{
    id: string;
    title: string;
    url: string;
    domain: string | null;
    favicon_url: string | null;
    open_count: number;
    last_opened_at: number | null;
    created_at: number;
    folder_id: string | null;
    folder_name: string | null;
    folder_icon: string | null;
  }>(sql`
    SELECT s.id, s.title, s.url, s.domain, s.favicon_url, s.open_count, s.last_opened_at, s.created_at,
      c.id AS folder_id, c.name AS folder_name, c.icon AS folder_icon
    FROM saves s
    LEFT JOIN collections c ON c.id = (
      SELECT sc.collection_id FROM save_collections sc JOIN collections cc ON cc.id = sc.collection_id
      WHERE sc.save_id = s.id ORDER BY cc.name LIMIT 1)
    WHERE s.is_bookmark = 1 AND s.is_archived = 0 AND s.url IS NOT NULL
    ORDER BY s.title COLLATE NOCASE LIMIT ${limit}`);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    domain: r.domain,
    faviconUrl: r.favicon_url,
    folder: r.folder_id ? { id: r.folder_id, name: r.folder_name!, icon: r.folder_icon } : null,
    openCount: r.open_count,
    lastOpenedAt: r.last_opened_at,
    createdAt: r.created_at,
  }));
}

/**
 * Adds links (e.g. pasted from Safari's "Copy Links") as bookmarks. Links already in the
 * library are marked as bookmarks instead of duplicated. Returns ids that need metadata.
 */
export async function addBookmarks(
  links: { url: string; title?: string }[],
  collectionId?: string,
): Promise<{ added: number; existing: number; enrich: string[] }> {
  let added = 0;
  let existing = 0;
  const enrich: string[] = [];
  for (const l of links) {
    const r = await createSave(
      {
        url: l.url,
        title: l.title,
        bookmark: true,
        collectionIds: collectionId ? [collectionId] : undefined,
      },
      { captureMethod: "web" },
    );
    if (r.duplicate) existing++;
    else added++;
    if (r.needsEnrichment) enrich.push(r.id);
  }
  return { added, existing, enrich };
}

/** Full readable text of a save (note body, then extracted page/image text), capped. */
export async function getSaveText(id: string, max = 50_000): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({ body: saves.body, text: saves.extractedText })
    .from(saves)
    .where(eq(saves.id, id));
  if (!row) return null;
  return [row.body, row.text].filter(Boolean).join("\n\n").slice(0, max);
}

/**
 * Forgotten saves worth a second look: older than two weeks and not opened in the last two
 * months. The pick is shuffled per day, so it's stable across reloads but changes daily.
 */
export async function rediscover(limit = 4, now = Date.now()): Promise<SaveView[]> {
  const db = await getDb();
  const DAY = 86_400_000;
  const day = Math.floor(now / DAY);
  const seed = (day % 997) + 101;
  const rows = await db.all<SaveRowRaw>(
    sql`SELECT ${SAVE_COLUMNS} FROM saves s
        WHERE s.is_archived = 0 AND s.created_at < ${now - 14 * DAY}
          AND (s.last_opened_at IS NULL OR s.last_opened_at < ${now - 60 * DAY})
        ORDER BY (s.seq * ${seed}) % 7919 LIMIT ${limit}`,
  );
  return hydrate(db, rows);
}

/**
 * Serendipity: a shuffled queue of older saves to review one at a time. Skips anything
 * archived, snoozed, saved in the last 3 days, or reviewed in the last 30 days.
 */
export async function serendipityQueue(limit = 30, now = Date.now()): Promise<SaveView[]> {
  const db = await getDb();
  const DAY = 86_400_000;
  const rows = await db.all<SaveRowRaw>(
    sql`SELECT ${SAVE_COLUMNS} FROM saves s
        WHERE s.is_archived = 0 AND s.created_at < ${now - 3 * DAY}
          AND (s.snoozed_until IS NULL OR s.snoozed_until <= ${now})
          AND coalesce(json_extract(s.metadata, '$.reviewedAt'), 0) < ${now - 30 * DAY}
        ORDER BY random() LIMIT ${Math.min(Math.max(limit, 1), 100)}`,
  );
  return hydrate(db, rows);
}

export type ReviewDecision = "keep" | "archive" | "favorite" | "snooze";

/** Applies a Serendipity decision and remembers the save was reviewed. */
export async function reviewSave(id: string, decision: ReviewDecision, now = Date.now()) {
  if (decision === "archive") await bulkUpdate([id], { kind: "archive" });
  if (decision === "favorite") await bulkUpdate([id], { kind: "favorite" });
  if (decision === "snooze")
    await bulkUpdate([id], { kind: "snooze", until: now + 7 * 86_400_000 });
  const db = await getDb();
  await db.run(sql`UPDATE saves SET metadata = json_set(coalesce(metadata, '{}'), '$.reviewedAt', ${now})
    WHERE id = ${id}`);
}

export async function recentlyOpened(limit = 6): Promise<SaveView[]> {
  const db = await getDb();
  const rows = await db.all<SaveRowRaw>(
    sql`SELECT ${SAVE_COLUMNS} FROM saves s WHERE s.last_opened_at IS NOT NULL AND s.is_archived = 0
        ORDER BY s.last_opened_at DESC LIMIT ${limit}`,
  );
  return hydrate(db, rows);
}

export async function libraryStats() {
  const db = await getDb();
  const [row] = await db.all<{
    saves: number;
    inbox: number;
    snoozed: number;
    collections: number;
    sessions: number;
    tags: number;
    favorites: number;
    bookmarks: number;
    archived: number;
  }>(sql`
    SELECT
      (SELECT count(*) FROM saves WHERE is_archived = 0) AS saves,
      (SELECT count(*) FROM saves WHERE status = 'inbox' AND is_archived = 0
         AND (snoozed_until IS NULL OR snoozed_until <= ${Date.now()})) AS inbox,
      (SELECT count(*) FROM saves WHERE snoozed_until > ${Date.now()} AND is_archived = 0) AS snoozed,
      (SELECT count(*) FROM saves WHERE is_favorite = 1 AND is_archived = 0) AS favorites,
      (SELECT count(*) FROM saves WHERE is_bookmark = 1 AND is_archived = 0) AS bookmarks,
      (SELECT count(*) FROM saves WHERE is_archived = 1) AS archived,
      (SELECT count(*) FROM collections) AS collections,
      (SELECT count(*) FROM sessions) AS sessions,
      (SELECT count(*) FROM tags) AS tags`);
  return row!;
}
