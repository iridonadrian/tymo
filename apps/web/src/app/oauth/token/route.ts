import { exchangeToken, publicOrigin } from "@/server/oauth";
import { oauthError, oauthJson, preflight, readBody, throttle } from "@/server/oauth-http";

/** Token endpoint: authorization_code (with PKCE) and refresh_token grants. */
export async function POST(req: Request) {
  try {
    throttle(req, "oauth-token", 30);
    return oauthJson(await exchangeToken(await readBody(req), publicOrigin(req.headers)));
  } catch (err) {
    return oauthError(err);
  }
}
export const OPTIONS = preflight;
