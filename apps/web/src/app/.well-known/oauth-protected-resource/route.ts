import { protectedResourceMetadata, publicOrigin } from "@/server/oauth";
import { oauthJson, preflight } from "@/server/oauth-http";

/** RFC 9728 Protected Resource Metadata for the MCP endpoint. */
export function GET(req: Request) {
  return oauthJson(protectedResourceMetadata(publicOrigin(req.headers)), 200, {
    "Cache-Control": "public, max-age=300",
  });
}
export const OPTIONS = preflight;
