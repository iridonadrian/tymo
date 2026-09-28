import { revokeToken } from "@/server/oauth";
import { oauthError, preflight, readBody, throttle } from "@/server/oauth-http";
import { CORS } from "@/server/oauth-http";

/** RFC 7009 token revocation. */
export async function POST(req: Request) {
  try {
    throttle(req, "oauth-revoke", 30);
    const body = await readBody(req);
    await revokeToken(typeof body.token === "string" ? body.token : undefined);
    return new Response(null, { status: 200, headers: CORS });
  } catch (err) {
    return oauthError(err);
  }
}
export const OPTIONS = preflight;
