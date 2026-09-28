import type { NextRequest } from "next/server";
import { json, preflight, withApi } from "@/server/api";
import { listTags } from "@/server/tags";

export const OPTIONS = (req: NextRequest) => preflight(req);
export const GET = withApi(async (req) =>
  json(req, { tags: (await listTags()).slice(0, 500).map((t) => t.name) }),
);
