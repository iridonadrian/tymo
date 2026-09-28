import { handleMcpRequest } from "@/server/mcp";
import { SCOPE_WRITE, publicOrigin, verifyAccessToken } from "@/server/oauth";
import { CORS, preflight } from "@/server/oauth-http";
import { rateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/privacy";
import { verifyApiToken } from "@/server/tokens";

/**
 * Remote MCP endpoint (Streamable HTTP). Accepts an OAuth access token from the connector
 * flow (claude.ai), or a regular Tymo API token for clients configured with a header.
 */
async function handle(req: Request): Promise<Response> {
  const origin = publicOrigin(req.headers);
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  let key: string | null = null;
  let canWrite = false;
  if (token?.startsWith("tyat_")) {
    const grant = await verifyAccessToken(token, origin);
    if (grant) {
      key = `grant:${grant.grantId}`;
      canWrite = grant.scopes.includes(SCOPE_WRITE);
    }
  } else if (token) {
    const row = await verifyApiToken(token);
    if (row) {
      key = `api:${row.id}`;
      canWrite = true;
    }
  }
  if (!key) {
    if (token && !rateLimit(`mcp-badtoken:${clientIp(req.headers)}`, 20))
      return new Response("Too many failed attempts", { status: 429, headers: CORS });
    const challenge =
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` +
      (token ? `, error="invalid_token"` : "");
    return Response.json(
      { error: token ? "invalid_token" : "unauthorized" },
      { status: 401, headers: { ...CORS, "WWW-Authenticate": challenge } },
    );
  }
  if (!rateLimit(key, 240))
    return new Response("Rate limit exceeded", { status: 429, headers: CORS });
  const res = await handleMcpRequest(req, canWrite);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, headers });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = preflight;
