import { getDb } from "@/server/db";

export async function GET() {
  await getDb();
  return Response.json({ ok: true, app: "tymo" }, { headers: { "Cache-Control": "no-store" } });
}
