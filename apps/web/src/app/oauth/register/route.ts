import { registerClient } from "@/server/oauth";
import { oauthError, oauthJson, preflight, readBody, throttle } from "@/server/oauth-http";

/** RFC 7591 Dynamic Client Registration (public clients only). */
export async function POST(req: Request) {
  try {
    throttle(req, "oauth-register", 10);
    return oauthJson(await registerClient(await readBody(req)), 201);
  } catch (err) {
    return oauthError(err);
  }
}
export const OPTIONS = preflight;
