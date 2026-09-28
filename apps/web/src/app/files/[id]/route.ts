import { readStoredFile } from "@/server/files";

/**
 * Serves uploaded files with a server-determined type and a sandbox CSP, so even a
 * crafted file can't run script in Tymo's origin.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const file = await readStoredFile(id);
  if (!file) return new Response("Not found", { status: 404 });
  const isPdf = file.row.mime === "application/pdf";
  const isArchive = file.row.kind === "snapshot";
  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = (file.row.originalName ?? `tymo-${id}`).replace(/[^\w.\- ]+/g, "_").slice(0, 100);
  // Archived pages: no scripts, no network (images/CSS are inlined as data:), links may open
  // a new tab on click. Everything else: a plain sandbox.
  const csp = isArchive
    ? "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'"
    : "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.row.mime,
      "Content-Length": String(file.row.size),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": csp,
      "Content-Disposition": `${download || isPdf ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, max-age=31536000, immutable",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
