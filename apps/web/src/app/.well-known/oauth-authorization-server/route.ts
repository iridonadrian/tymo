import { authorizationServerMetadata, publicOrigin } from "@/server/oauth";
import { oauthJson, preflight } from "@/server/oauth-http";

/** RFC 8414 Authorization Server Metadata. */
export function GET(req: Request) {
  return oauthJson(authorizationServerMetadata(publicOrigin(req.headers)), 200, {
    "Cache-Control": "public, max-age=300",
  });
}
export const OPTIONS = preflight;
