import type { NextRequest } from "next/server";
import { z } from "zod";
import { json, preflight, withApi } from "@/server/api";
import { getDb } from "@/server/db";
import { findByUrl, getSave, libraryStats } from "@/server/saves";

export const OPTIONS = (req: NextRequest) => preflight(req);

const query = z.object({ url: z.string().max(4000).optional() });

/**
 * For the browser extension: is this page already in the library (and where), plus the
 * Inbox count for its header. Returns only what the popup shows.
 */
export const GET = withApi(async (req) => {
  const { url } = query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const hit = url ? await findByUrl(await getDb(), url) : null;
  const s = hit ? await getSave(hit.id) : null;
  const { inbox } = await libraryStats();
  return json(req, {
    inbox,
    save: s
      ? {
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          isFavorite: s.isFavorite,
          isBookmark: s.isBookmark,
          isArchived: s.isArchived,
          status: s.status,
          tags: s.tags,
          collections: s.collections.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
        }
      : null,
  });
});
