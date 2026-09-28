import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_PASTED_LINKS, httpUrl } from "@tymo/core";
import { json, preflight, readJson, withApi } from "@/server/api";
import { addBookmarks, listBookmarks } from "@/server/saves";
import { ensureCollectionPath } from "@/server/collections";
import { enqueueEnrichment } from "@/server/enrich";

export const OPTIONS = (req: NextRequest) => preflight(req);

const body = z.object({
  links: z
    .array(
      z.object({
        url: httpUrl,
        title: z.string().trim().max(500).optional(),
        /** Folder name, e.g. the browser tab group the tab was in. */
        folder: z.string().trim().max(80).optional(),
      }),
    )
    .min(1)
    .max(MAX_PASTED_LINKS),
  folder: z.string().trim().max(80).optional(),
});

/** Adds links as bookmarks (the extension's "Save tabs as bookmarks"). */
export const POST = withApi(async (req) => {
  const { links, folder } = body.parse(await readJson(req, 512 * 1024));
  const byFolder = new Map<string, { url: string; title?: string }[]>();
  for (const l of links) {
    const name = l.folder || folder || "";
    byFolder.set(name, [...(byFolder.get(name) ?? []), { url: l.url, title: l.title }]);
  }
  let added = 0;
  let existing = 0;
  const cache = new Map<string, string>();
  for (const [name, group] of byFolder) {
    const collectionId = name
      ? ((await ensureCollectionPath([name], cache)) ?? undefined)
      : undefined;
    const r = await addBookmarks(group, collectionId);
    added += r.added;
    existing += r.existing;
    enqueueEnrichment(r.enrich);
  }
  revalidatePath("/", "layout");
  return json(req, { added, existing }, 201);
});

/** The Bookmarks page as JSON (for scripts and launchers). */
export const GET = withApi(async (req) => json(req, { items: await listBookmarks() }));
