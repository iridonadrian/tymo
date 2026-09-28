/**
 * HTTP helpers for the OAuth and MCP endpoints. They use bearer tokens and PKCE, never
 * cookies, so allowing any origin (for browser-based MCP clients) exposes nothing extra.
 */
import { OAuthError } from "./oauth";
import { rateLimit } from "./rate-limit";
import { clientIp } from "./privacy";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Expose-Headers": "www-authenticate, mcp-session-id",
  "Access-Control-Max-Age": "600",
};

export const preflight = () => new Response(null, { status: 204, headers: CORS });

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache", ...extra },
  });
}

export function oauthError(err: unknown) {
  if (err instanceof OAuthError)
    return oauthJson({ error: err.code, error_description: err.message }, err.status);
  console.error("[oauth]", err);
  return oauthJson({ error: "server_error", error_description: "Unexpected error" }, 500);
}

/** Per-client throttle for the unauthenticated endpoints. */
export function throttle(req: Request, bucket: string, perMinute: number) {
  if (!rateLimit(`${bucket}:${clientIp(req.headers)}`, perMinute))
    throw new OAuthError("slow_down", "Too many requests, try again in a minute", 429);
}

/** Reads a JSON or form-encoded body (token endpoints use forms) with a size cap. */
export async function readBody(req: Request, max = 16 * 1024): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > max) throw new OAuthError("invalid_request", "Request too large", 413);
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      const v: unknown = JSON.parse(text);
      return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    } catch {
      throw new OAuthError("invalid_request", "Body must be JSON");
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}
