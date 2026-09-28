import { EXPORT_FORMATS, exportLibrary, type ExportFormat } from "@/server/exporter";

export async function GET(req: Request) {
  const format = new URL(req.url).searchParams.get("format") ?? "json";
  if (!(EXPORT_FORMATS as readonly string[]).includes(format))
    return new Response("Unknown format", { status: 400 });
  const out = await exportLibrary(format as ExportFormat);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(out.body, {
    headers: {
      "Content-Type": `${out.mime}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="tymo-export-${date}.${out.ext}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
