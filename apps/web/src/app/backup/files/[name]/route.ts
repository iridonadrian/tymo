import fs from "node:fs";
import { Readable } from "node:stream";
import { storedBackupPath } from "@/server/backup";

/** Downloads one of the automatic backups kept in DATA_DIR/backups. */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const file = storedBackupPath(name);
  if (!file || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
  const stat = fs.statSync(file);
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
