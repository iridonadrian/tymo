import type { NextRequest } from "next/server";
import { ApiError, json, preflight, withApi } from "@/server/api";
import { getSession, markSessionRestored } from "@/server/sessions";

export const OPTIONS = (req: NextRequest) => preflight(req);

export const GET = withApi(async (req, { params }) => {
  const s = await getSession(params.id!);
  if (!s) throw new ApiError(404, "Session not found");
  return json(req, {
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    tabs: s.items.map((i) => ({
      url: i.url,
      title: i.title,
      windowIndex: i.windowIndex,
      pinned: i.pinned,
      groupTitle: i.groupTitle,
      groupColor: i.groupColor,
    })),
  });
});

/** The extension reports a completed restore. */
export const POST = withApi(async (req, { params }) => {
  await markSessionRestored(params.id!);
  return json(req, { ok: true });
});
