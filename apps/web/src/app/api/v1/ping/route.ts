import type { NextRequest } from "next/server";
import { json, preflight, withApi } from "@/server/api";
import { config } from "@/server/config";

export const OPTIONS = (req: NextRequest) => preflight(req);
export const GET = withApi(async (req) =>
  json(req, { ok: true, app: "tymo", version: config.version }),
);
