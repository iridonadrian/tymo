import { z } from "zod";
import { isHttpUrl } from "@tymo/core";
import { getProxiedImage } from "@/server/images";

const query = z
  .string()
  .max(2048)
  .refine((u) => isHttpUrl(u), "Invalid URL");

/**
 * Privacy image proxy: `/img?u=<url>`. Sits behind the password gate like every page.
 * Responses carry a sandbox CSP so an SVG opened directly can't run script in our origin.
 */
export async function GET(req: Request) {
  const parsed = query.safeParse(new URL(req.url).searchParams.get("u"));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const img = await getProxiedImage(parsed.data);
  if (!img) {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  }
  return new Response(new Uint8Array(img.data), {
    headers: {
      "Content-Type": img.mime,
      "Content-Length": String(img.data.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      "Cache-Control": "private, max-age=86400",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
