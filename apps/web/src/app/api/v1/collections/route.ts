import type { NextRequest } from "next/server";
import { json, preflight, withApi } from "@/server/api";
import { listCollections } from "@/server/collections";

export const OPTIONS = (req: NextRequest) => preflight(req);
export const GET = withApi(async (req) => {
  const cols = await listCollections();
  return json(req, {
    collections: cols
      .filter((c) => !c.smart)
      .map((c) => ({ id: c.id, name: c.name, icon: c.icon, parentId: c.parentId })),
  });
});
