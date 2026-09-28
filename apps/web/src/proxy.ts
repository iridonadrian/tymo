import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, verifySessionCookie } from "@/server/auth";
import { hostAllowed } from "@/server/hosts";

/**
 * Runs on every page request:
 *  0. Without a password: reject unknown Host headers (DNS-rebinding guard, server/hosts.ts).
 *  1. Optional password gate (TYMO_PASSWORD) for self-hosted deployments.
 *  2. Per-request CSP nonce.
 * /api/v1, /mcp and the OAuth token endpoints use bearer tokens instead and skip the gate.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!authEnabled() && !hostAllowed(request.headers.get("host"))) {
    return new NextResponse(
      "Host not allowed. Add it to TYMO_ALLOWED_HOSTS, or set TYMO_PASSWORD.",
      { status: 421, headers: { "content-type": "text/plain" } },
    );
  }
  // Token-authenticated endpoints: the REST API, remote MCP and the OAuth machinery that issues
  // its tokens. The consent page (/oauth/authorize) is NOT here: it stays behind the gate.
  const isApi =
    pathname.startsWith("/api/v1/") ||
    pathname === "/mcp" ||
    pathname.startsWith("/.well-known/oauth-") ||
    pathname === "/oauth/register" ||
    pathname === "/oauth/token" ||
    pathname === "/oauth/revoke";
  // App icons and the manifest carry no data and must load on the login screen too.
  const isAsset =
    /^\/(manifest\.webmanifest|icon(-[\w-]+)?\.(svg|png)|apple-touch-icon\.png)$/.test(pathname);
  const isPublic = pathname === "/login" || isApi || isAsset || pathname === "/api/health";

  if (
    authEnabled() &&
    !isPublic &&
    !verifySessionCookie(request.cookies.get(SESSION_COOKIE)?.value)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search =
      pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  if (isApi) return NextResponse.next();

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used by React for a few dynamic values; styles can't execute code.
    "style-src 'self' 'unsafe-inline'",
    // Remote favicons and previews are served by the same-origin image proxy (/img).
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

// Prefetches are deliberately NOT excluded: they must pass the auth gate too.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
