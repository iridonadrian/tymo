import type { NextRequest } from "next/server";
import { json, preflight, withApi } from "@/server/api";
import { collectionInput } from "@tymo/core";
import { createCollection, listCollections } from "@/server/collections";

export const OPTIONS = (req: NextRequest) => preflight(req);
export const GET = withApi(async (req) => {
  const cols = await listCollections();
  return json(req, {
    collections: cols
      .filter((c) => !c.smart)
      .map((c) => ({ id: c.id, name: c.name, icon: c.icon, parentId: c.parentId })),
  });
});

export const POST = withApi(async (req) => {
  const body = collectionInput.parse(await req.json());
  const id = await createCollection(body);
  return json(req, { id }, 201);
});
