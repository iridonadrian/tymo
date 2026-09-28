/**
 * Full-page archiving: a self-contained, script-free copy of a saved page, stored as a
 * `files.kind = 'snapshot'` row and served sandboxed from /files/:id.
 * All network access goes through the SSRF-safe fetchers; imports never archive.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { collectArchiveResources, rewriteForArchive } from "@tymo/core/archive";
import { getDb, schema } from "./db";
import { safeFetch, safeFetchBytes } from "./fetcher";
import { deleteStoredFiles, storeFile } from "./files";
import { getProxiedImage } from "./images";
import { getSetting, setSetting } from "./settings";

const MAX_CSS_BYTES = 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const CONCURRENCY = 4;

export const archiveSettingsSchema = z.object({
  /** Archive every new web page automatically after its metadata is fetched. */
  auto: z.boolean().default(false),
});
export type ArchiveSettings = z.infer<typeof archiveSettingsSchema>;

export async function getArchiveSettings(): Promise<ArchiveSettings> {
  const stored = archiveSettingsSchema.safeParse((await getSetting("archive")) ?? {});
  const s = stored.success ? stored.data : archiveSettingsSchema.parse({});
  const env = process.env.TYMO_AUTO_ARCHIVE;
  return { auto: env ? env === "1" : s.auto };
}

export async function saveArchiveSettings(input: Partial<ArchiveSettings>) {
  const current = archiveSettingsSchema.parse((await getSetting("archive")) ?? {});
  await setSetting("archive", archiveSettingsSchema.parse({ ...current, ...input }));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

async function fetchCss(url: string): Promise<string | null> {
  try {
    const res = await safeFetchBytes(url, {
      accept: "text/css,*/*;q=0.1",
      maxBytes: MAX_CSS_BYTES,
    });
    if (res.status >= 400 || res.truncated) return null;
    if (res.contentType && !/css|text\/plain/i.test(res.contentType)) return null;
    return new TextDecoder().decode(res.bytes);
  } catch {
    return null;
  }
}

/** Archives a save's page. Replaces any previous archive of the same save. */
export async function archiveSave(saveId: string) {
  const db = await getDb();
  const [save] = await db.select().from(schema.saves).where(eq(schema.saves.id, saveId));
  if (!save) throw new Error("Save not found");
  if (!save.url) throw new Error("Only saves with a URL can be archived");

  const page = await safeFetch(save.url);
  if (!page.html) throw new Error("This URL is not a web page, so there is nothing to archive");
  if (page.status >= 400) throw new Error(`The page returned HTTP ${page.status}`);

  const res = collectArchiveResources(page.html, page.finalUrl);
  const cssList = await mapLimit(res.stylesheets, CONCURRENCY, fetchCss);
  const styles = new Map<string, string>();
  res.stylesheets.forEach((u, i) => cssList[i] && styles.set(u, cssList[i]!));

  const images = new Map<string, string>();
  let budget = MAX_INLINE_IMAGE_BYTES;
  const imgs = await mapLimit(res.images, CONCURRENCY, getProxiedImage);
  res.images.forEach((u, i) => {
    const img = imgs[i];
    if (!img || img.data.byteLength > budget) return;
    budget -= img.data.byteLength;
    images.set(u, `data:${img.mime};base64,${Buffer.from(img.data).toString("base64")}`);
  });

  const html = rewriteForArchive(page.html, page.finalUrl, {
    styles,
    images,
    originalUrl: save.url,
    archivedAt: Date.now(),
  });
  const bytes = new TextEncoder().encode(html);
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("The archived page is too large");

  const old = await db
    .select({ id: schema.files.id, key: schema.files.storageKey })
    .from(schema.files)
    .where(and(eq(schema.files.saveId, saveId), eq(schema.files.kind, "snapshot")));
  const stored = await storeFile(bytes, {
    saveId,
    kind: "snapshot",
    originalName: `${(save.domain ?? "page").replace(/[^\w.-]+/g, "_")}.html`,
    maxBytes: MAX_ARCHIVE_BYTES,
  });
  if (old.length) {
    for (const o of old) await db.delete(schema.files).where(eq(schema.files.id, o.id));
    await deleteStoredFiles(old.map((o) => o.key));
  }
  const [fresh] = await db
    .select({ metadata: schema.saves.metadata })
    .from(schema.saves)
    .where(eq(schema.saves.id, saveId));
  await db
    .update(schema.saves)
    .set({ metadata: { ...(fresh?.metadata ?? {}), archivedAt: Date.now() } })
    .where(eq(schema.saves.id, saveId));
  return {
    fileId: stored.id,
    size: bytes.byteLength,
    images: images.size,
    stylesheets: styles.size,
  };
}
