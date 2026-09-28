import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { httpUrl, tagList } from "@tymo/core";
import { ApiError, json, preflight, readJson, withApi } from "@/server/api";
import { createSave, deleteSaves } from "@/server/saves";
import { MAX_SCREENSHOT_BYTES, storeFile } from "@/server/files";
import { enqueueOcr } from "@/server/ocr";
import { publicErrorMessage } from "@/server/privacy";

export const OPTIONS = (req: NextRequest) => preflight(req);

const schema = z.object({
  dataUrl: z.string().max(Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 64),
  title: z.string().max(500).optional(),
  sourceUrl: httpUrl.optional(),
  collectionIds: z.array(z.string().max(64)).max(20).optional(),
  tags: tagList.optional(),
  notes: z.string().max(10_000).optional(),
});

export const POST = withApi(async (req) => {
  const input = schema.parse(
    await readJson(req, Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 64 * 1024),
  );
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(input.dataUrl);
  if (!m) throw new ApiError(400, "dataUrl must be a base64 PNG or JPEG");
  const bytes = new Uint8Array(Buffer.from(m[2]!, "base64"));

  const created = await createSave(
    {
      title: input.title?.trim() || "Screenshot",
      type: "screenshot",
      source: input.sourceUrl,
      notes: input.notes,
      tags: input.tags,
      collectionIds: input.collectionIds,
      metadata: input.sourceUrl ? { sourceUrl: input.sourceUrl } : undefined,
    },
    { captureMethod: "extension-screenshot" },
  );
  try {
    await storeFile(bytes, {
      saveId: created.id,
      kind: "screenshot",
      maxBytes: MAX_SCREENSHOT_BYTES,
    });
  } catch (err) {
    await deleteSaves([created.id]);
    throw new ApiError(400, publicErrorMessage(err, "Invalid image"));
  }
  enqueueOcr([created.id]);
  revalidatePath("/", "layout");
  return json(req, { id: created.id }, 201);
});
