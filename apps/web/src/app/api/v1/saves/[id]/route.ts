import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { updateSaveInput } from "@tymo/core";
import { ApiError, json, preflight, readJson, withApi } from "@/server/api";
import { deleteSaves, getSave, getSaveText, updateSave } from "@/server/saves";

export const OPTIONS = (req: NextRequest) => preflight(req);

async function load(id: string) {
  const save = await getSave(id);
  if (!save) throw new ApiError(404, "Save not found");
  return save;
}

/** One save with its full readable text (`?text=0` to omit it). */
export const GET = withApi(async (req, { params }) => {
  const save = await load(params.id!);
  const withText = req.nextUrl.searchParams.get("text") !== "0";
  return json(req, { ...save, text: withText ? await getSaveText(save.id) : undefined });
});

export const PATCH = withApi(async (req, { params }) => {
  await load(params.id!);
  await updateSave(params.id!, updateSaveInput.parse(await readJson(req, 512 * 1024)));
  revalidatePath("/", "layout");
  return json(req, await getSave(params.id!));
});

export const DELETE = withApi(async (req, { params }) => {
  await load(params.id!);
  await deleteSaves([params.id!]);
  revalidatePath("/", "layout");
  return json(req, { ok: true });
});
