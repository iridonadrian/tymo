import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { ApiError, json, preflight, withApi } from "@/server/api";
import { archiveSave } from "@/server/archive";
import { getSave } from "@/server/saves";

export const OPTIONS = (req: NextRequest) => preflight(req);

/** Stores (or replaces) an offline copy of the save's page. */
export const POST = withApi(async (req, { params }) => {
  if (!(await getSave(params.id!))) throw new ApiError(404, "Save not found");
  const r = await archiveSave(params.id!);
  revalidatePath("/", "layout");
  return json(req, r, 201);
});
