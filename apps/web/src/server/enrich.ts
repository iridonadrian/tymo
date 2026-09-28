/**
 * Background metadata enrichment. Saves are created instantly with what the client knows;
 * this fills in title/description/icon/preview/text afterwards.
 */
import { and, eq, sql } from "drizzle-orm";
import { cleanTitle, detectType, domainOf, repoInfo, titleFromUrl } from "@tymo/core";
import { parseHtmlMetadata } from "@tymo/core/html-metadata";
import { extractReader, readerText } from "@tymo/core/reader";
import { safeFetch } from "./fetcher";
import { getDb, schema } from "./db";
import { reindexSave } from "./search";
import { getAiSettings } from "./settings";
import { suggestForSave } from "./ai";
import { archiveSave, getArchiveSettings } from "./archive";
import { enqueueOcr, ocrEnabled } from "./ocr";

const CONCURRENCY = 4;
const queue: string[] = [];
const queued = new Set<string>();
let running = 0;

export function enqueueEnrichment(ids: string[]) {
  for (const id of ids) {
    if (queued.has(id)) continue;
    queued.add(id);
    queue.push(id);
  }
  pump();
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift()!;
    running++;
    enrichSave(id)
      .catch((err) => console.warn(`[enrich] ${id}: ${err instanceof Error ? err.message : err}`))
      .finally(() => {
        running--;
        queued.delete(id);
        pump();
      });
  }
}

/** Re-queues saves left pending by a restart. */
export async function resumePendingEnrichment() {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.saves.id })
    .from(schema.saves)
    .where(eq(schema.saves.metadataStatus, "pending"))
    .limit(500);
  enqueueEnrichment(rows.map((r) => r.id));
}

export async function enrichSave(id: string) {
  const db = await getDb();
  const [save] = await db.select().from(schema.saves).where(eq(schema.saves.id, id));
  if (!save?.url) return;

  try {
    const res = await safeFetch(save.url);
    const patch: Partial<typeof schema.saves.$inferInsert> = {
      metadataStatus: "done",
      updatedAt: Date.now(),
    };
    const titleIsPlaceholder =
      !save.title || save.title === save.url || save.title === titleFromUrl(save.url);
    const metadata = { ...(save.metadata ?? {}) } as Record<string, unknown>;

    if (res.html) {
      const m = parseHtmlMetadata(res.html, res.finalUrl);
      if (m.title && titleIsPlaceholder) patch.title = cleanTitle(m.title, res.finalUrl);
      if (m.description && !save.description) patch.description = m.description;
      if (m.faviconUrl && !save.faviconUrl) patch.faviconUrl = m.faviconUrl;
      if (m.imageUrl && !save.imageUrl) {
        patch.imageUrl = m.imageUrl;
        delete metadata.colors; // measured again from the new image
        delete metadata.colorNames;
      }
      // The reader view's article text indexes better than the whole page (no menus/footers).
      const reader = extractReader(res.html, res.finalUrl, patch.title ?? save.title);
      patch.reader = reader;
      if (reader && reader.words >= 100) patch.extractedText = readerText(reader).slice(0, 50_000);
      else if (m.text) patch.extractedText = m.text;
      if (reader) metadata.words = reader.words;
      if (m.siteName) metadata.siteName = m.siteName;
      if (m.author) metadata.author = m.author;
      if (m.publishedAt) metadata.publishedAt = m.publishedAt;
      if (m.facts) metadata.facts = m.facts;
      if (save.type === "link") {
        const t = detectType(res.finalUrl, { ogType: m.ogType, jsonLdTypes: m.jsonLdTypes });
        if (t !== "link") patch.type = t;
      }
    } else if (save.type === "link") {
      const t = detectType(res.finalUrl, { contentType: res.contentType });
      if (t !== "link") patch.type = t;
    }
    if (res.finalUrl !== save.url) metadata.finalUrl = res.finalUrl;
    if (!patch.faviconUrl && !save.faviconUrl) {
      const host = domainOf(res.finalUrl);
      if (host) patch.faviconUrl = new URL("/favicon.ico", res.finalUrl).toString();
    }
    const type = patch.type ?? save.type;
    if (type === "repo") Object.assign(metadata, repoInfo(save.url) ?? {});
    patch.metadata = Object.keys(metadata).length ? metadata : null;

    await db.update(schema.saves).set(patch).where(eq(schema.saves.id, id));
    await reindexSave(db, id);
  } catch (err) {
    await db
      .update(schema.saves)
      .set({ metadataStatus: "failed", updatedAt: Date.now() })
      .where(eq(schema.saves.id, id));
    throw err;
  }

  const [snapshot] = await db
    .select({ id: schema.files.id })
    .from(schema.files)
    .where(and(eq(schema.files.saveId, id), eq(schema.files.kind, "snapshot")))
    .limit(1);
  if (!snapshot && (await getArchiveSettings()).auto) {
    await archiveSave(id).catch((err) =>
      console.warn(`[archive] ${id}: ${err instanceof Error ? err.message : err}`),
    );
  }

  // Describe product/image previews so they can be found by what they show.
  const [after] = await db
    .select({
      type: schema.saves.type,
      imageUrl: schema.saves.imageUrl,
      metadata: schema.saves.metadata,
    })
    .from(schema.saves)
    .where(eq(schema.saves.id, id));
  if (
    after?.imageUrl &&
    ["image", "product"].includes(after.type) &&
    !after.metadata?.imageDescription &&
    (await ocrEnabled())
  ) {
    enqueueOcr([id]);
  }

  const ai = await getAiSettings();
  if (ai.provider !== "none" && ai.autoSuggest) {
    await suggestForSave(id).catch((err) =>
      console.warn(`[ai] ${id}: ${err instanceof Error ? err.message : err}`),
    );
  }
}

export async function pendingCount() {
  const db = await getDb();
  const [row] = await db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM saves WHERE metadata_status = 'pending'`,
  );
  return row?.n ?? 0;
}
