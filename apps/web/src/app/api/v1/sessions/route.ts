import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { createSessionInput } from "@tymo/core";
import { ApiError, json, preflight, readJson, withApi } from "@/server/api";
import { createSession, listSessions } from "@/server/sessions";
import { publicErrorMessage } from "@/server/privacy";

export const OPTIONS = (req: NextRequest) => preflight(req);

export const GET = withApi(async (req) => {
  const sessions = await listSessions(30);
  return json(req, {
    sessions: sessions.map(({ id, name, tabCount, createdAt, windows, favicons }) => ({
      id,
      name,
      tabCount,
      createdAt,
      windows,
      favicons,
    })),
  });
});

export const POST = withApi(async (req) => {
  const input = createSessionInput.parse(await readJson(req, 2 * 1024 * 1024));
  try {
    const r = await createSession(input);
    revalidatePath("/", "layout");
    return json(req, r, 201);
  } catch (err) {
    throw new ApiError(400, publicErrorMessage(err, "Could not save session"));
  }
});
