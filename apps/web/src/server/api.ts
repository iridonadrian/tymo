/**
 * Helpers for the extension-facing REST API (/api/v1). Bearer-token auth only — never
 * cookies — so these endpoints are not CSRF-able. CORS is granted to extension origins only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifyApiToken } from "./tokens";
import { rateLimit } from "./rate-limit";
import { clientIp, publicErrorMessage } from "./privacy";

const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension):\/\/[a-z0-9-]+$/i;

export function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !EXTENSION_ORIGIN.test(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function preflight(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export function json(req: NextRequest, body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { ...corsHeaders(req), "Cache-Control": "no-store" },
  });
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Handler = (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<Response>;

export function withApi(
  handler: Handler,
): (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> {
  return async (req, ctx) => {
    try {
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      const row = await verifyApiToken(token);
      if (!row) {
        // Only failures count, so a client guessing tokens is slowed down, not real clients.
        const ip = clientIp(req.headers);
        if (!rateLimit(`badtoken:${ip}`, 20))
          return json(req, { error: "Too many failed attempts" }, 429);
        return json(req, { error: "Invalid or missing API token" }, 401);
      }
      if (!rateLimit(`api:${row.id}`, 240)) return json(req, { error: "Rate limit exceeded" }, 429);
      return await handler(req, { params: await ctx.params });
    } catch (err) {
      if (err instanceof ApiError) return json(req, { error: err.message }, err.status);
      if (err instanceof z.ZodError)
        return json(
          req,
          { error: err.issues[0]?.message ?? "Invalid input", issues: err.issues.slice(0, 5) },
          400,
        );
      console.error("[api]", err);
      return json(req, { error: publicErrorMessage(err, "Server error") }, 500);
    }
  };
}

/** Reads a JSON body with a hard size cap (Content-Length can lie, so we count bytes). */
export async function readJson(req: NextRequest, maxBytes: number): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new ApiError(413, "Request body too large");
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, "Missing body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, "Request body too large");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "Body must be JSON");
  }
}
