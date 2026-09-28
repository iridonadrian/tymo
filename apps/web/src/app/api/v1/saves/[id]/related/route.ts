import type { NextRequest } from "next/server";
import { json, preflight, withApi } from "@/server/api";
import { relatedSaves } from "@/server/saves";

export const OPTIONS = (req: NextRequest) => preflight(req);

export const GET = withApi(async (req, { params }) =>
  json(req, { items: await relatedSaves(params.id!, 10) }),
);
