import { revalidatePath } from "next/cache";
import { createBackup, restoreBackup } from "@/server/backup";
import { publicErrorMessage } from "@/server/privacy";

/** Full backup download (database + files). Behind the password gate like every page. */
export async function GET() {
  try {
    const { stream, name } = await createBackup();
    return new Response(stream, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return new Response(publicErrorMessage(err, "Backup failed"), { status: 500 });
  }
}

let restoring = false;

/**
 * Restore replaces the whole library, so it only accepts same-origin requests (a route
 * handler has no built-in CSRF protection, unlike Server Actions).
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const site = req.headers.get("sec-fetch-site");
  let sameOrigin = false;
  try {
    sameOrigin = !!origin && !!host && new URL(origin).host === host;
  } catch {
    /* malformed Origin */
  }
  if (!sameOrigin || (site && site !== "same-origin"))
    return Response.json({ error: "Cross-origin restore refused" }, { status: 403 });
  if (!req.body) return Response.json({ error: "Upload a backup file" }, { status: 400 });
  if (restoring) return Response.json({ error: "A restore is already running" }, { status: 409 });
  restoring = true;
  try {
    const r = await restoreBackup(req.body);
    revalidatePath("/", "layout");
    return Response.json(r);
  } catch (err) {
    return Response.json({ error: publicErrorMessage(err, "Restore failed") }, { status: 400 });
  } finally {
    restoring = false;
  }
}
