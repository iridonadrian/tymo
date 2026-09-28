/**
 * Imports never trigger network fetches (see THREAT_MODEL.md): metadata can be refreshed
 * per item later. Every URL is re-validated by the same schema as manual saves.
 */
import { z } from "zod";
import { createSaveInput, httpUrl, SAVE_TYPES } from "@tymo/core";
import {
  MAX_IMPORT_ITEMS,
  parseNetscapeBookmarks,
  type ImportedBookmark,
} from "@tymo/core/bookmarks";
import { parsePinboardJson, parseServiceCsv } from "@tymo/core/services-import";
import { getDb } from "./db";
import { insertSave } from "./saves";
import { ensureCollectionPath } from "./collections";

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const CHUNK = 250;

export interface ImportResult {
  /** What the file was recognised as. */
  format?: string;
  imported: number;
  duplicates: number;
  skipped: number;
  collections: number;
}

async function importItems(
  items: (ImportedBookmark & {
    notes?: string;
    type?: string;
    favorite?: boolean;
    bookmark?: boolean;
  })[],
  skippedAlready: number,
) {
  const db = await getDb();
  const cache = new Map<string, string>();
  const result: ImportResult = {
    imported: 0,
    duplicates: 0,
    skipped: skippedAlready,
    collections: 0,
  };

  // Resolve folders first (outside the item transactions).
  const folderIds = new Map<string, string | null>();
  for (const item of items) {
    const key = item.folders.join("\u0000");
    if (!folderIds.has(key))
      folderIds.set(
        key,
        item.folders.length ? await ensureCollectionPath(item.folders, cache) : null,
      );
  }
  result.collections = cache.size;

  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    await db.transaction(
      async (tx) => {
        for (const item of chunk) {
          const colId = folderIds.get(item.folders.join("\u0000"));
          const parsed = createSaveInput.safeParse({
            url: item.url,
            title: item.title,
            description: item.description,
            notes: item.notes,
            tags: item.tags,
            favorite: item.favorite,
            bookmark: item.bookmark,
            type: (SAVE_TYPES as readonly string[]).includes(item.type ?? "")
              ? item.type
              : undefined,
            collectionIds: colId ? [colId] : [],
          });
          if (!parsed.success) {
            result.skipped++;
            continue;
          }
          const r = await insertSave(tx, parsed.data, {
            status: "active",
            captureMethod: "import",
            metadataStatus: "none",
            createdAt: item.addDate,
          });
          if (r.duplicate) result.duplicates++;
          else result.imported++;
        }
      },
      { behavior: "immediate" },
    );
  }
  return result;
}

export async function importBookmarksHtml(html: string): Promise<ImportResult> {
  const { items, skipped } = parseNetscapeBookmarks(html);
  // Browser bookmarks land on the Bookmarks page, in their folders.
  return importItems(
    items.map((i) => ({ ...i, bookmark: true })),
    skipped,
  );
}

const jsonExport = z.object({
  saves: z
    .array(
      z.object({
        url: httpUrl.nullable().optional(),
        title: z.string().max(500).default(""),
        description: z.string().max(5000).nullable().optional(),
        notes: z.string().max(50_000).nullable().optional(),
        type: z.string().max(30).optional(),
        tags: z.array(z.string().max(64)).max(50).default([]),
        collections: z.array(z.string().max(80)).max(50).default([]),
        favorite: z.boolean().optional(),
        bookmark: z.boolean().optional(),
        createdAt: z.number().int().positive().optional(),
      }),
    )
    .max(MAX_IMPORT_ITEMS),
});

export async function importJson(text: string): Promise<ImportResult> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON");
  }
  const pinboard = parsePinboardJson(data);
  if (pinboard)
    return { ...(await importItems(pinboard.items, pinboard.skipped)), format: "Pinboard" };
  const parsed = jsonExport.safeParse(data);
  if (!parsed.success)
    throw new Error(
      "Unrecognised JSON format. Expected a Tymo export ({ saves: [...] }) or a Pinboard export.",
    );
  const items = parsed.data.saves
    .filter((s) => s.url)
    .map((s) => ({
      url: s.url!,
      title: s.title,
      description: s.description ?? undefined,
      notes: s.notes ?? undefined,
      type: s.type,
      favorite: s.favorite,
      bookmark: s.bookmark,
      tags: s.tags,
      folders: s.collections.slice(0, 1),
      addDate: s.createdAt,
    }));
  return {
    ...(await importItems(items, parsed.data.saves.length - items.length)),
    format: "Tymo JSON",
  };
}

const FORMAT_NAMES: Record<string, string> = {
  pocket: "Pocket",
  raindrop: "Raindrop.io",
  instapaper: "Instapaper",
  "tymo-csv": "Tymo CSV",
  csv: "CSV",
};

export async function importCsv(text: string): Promise<ImportResult> {
  const { format, items, skipped } = parseServiceCsv(text);
  return { ...(await importItems(items, skipped)), format: FORMAT_NAMES[format] ?? format };
}

/** Picks the right importer from the file name and content. */
export async function importAuto(fileName: string, text: string): Promise<ImportResult> {
  const name = fileName.toLowerCase();
  const head = text.trimStart().slice(0, 500);
  if (name.endsWith(".json") || head.startsWith("{") || head.startsWith("["))
    return importJson(text);
  if (
    name.endsWith(".csv") ||
    (!/^</.test(head) && /url|link|href/i.test(head.split(/\r?\n/)[0] ?? ""))
  )
    return importCsv(text);
  return { ...(await importBookmarksHtml(text)), format: "Bookmarks HTML" };
}
