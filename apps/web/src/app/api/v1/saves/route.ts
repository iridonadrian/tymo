import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSaveInput } from "@tymo/core";
import { json, preflight, readJson, withApi } from "@/server/api";
import { createSave, listSaves } from "@/server/saves";
import { enqueueEnrichment } from "@/server/enrich";

export const OPTIONS = (req: NextRequest) => preflight(req);

const captureMethod = z.enum(["extension", "extension-context-menu"]).default("extension");

/** Create a save from the extension: current tab, a link, selected text, or an image URL. */
export const POST = withApi(async (req) => {
  const body = (await readJson(req, 512 * 1024)) as Record<string, unknown>;
  const input = createSaveInput.parse(body);
  const r = await createSave(input, { captureMethod: captureMethod.parse(body.captureMethod) });
  if (r.needsEnrichment) enqueueEnrichment([r.id]);
  revalidatePath("/", "layout");
  return json(req, r, r.duplicate ? 200 : 201);
});

const listQuery = z.object({
  q: z.string().max(500).optional(),
  view: z.enum(["all", "inbox", "favorites", "archive"]).optional(),
  collectionId: z.string().max(64).optional(),
  sort: z.enum(["newest", "oldest", "title", "opened", "relevance"]).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  semantic: z.enum(["0", "1"]).optional(),
});

/** Search / list saves. Same query language as the app (tag:, domain:, is:fav, …). */
export const GET = withApi(async (req) => {
  const p = listQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  const res = await listSaves({ ...p, semantic: p.semantic !== "0", limit: p.limit ?? 30 });
  return json(req, res);
});
