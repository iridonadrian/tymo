/**
 * OAuth 2.1 authorization server for remote MCP clients (claude.ai custom connectors and
 * other MCP apps), following the MCP authorization spec:
 *  - Protected Resource Metadata (RFC 9728) and Authorization Server Metadata (RFC 8414)
 *  - Dynamic Client Registration (RFC 7591) for public clients (no secrets)
 *  - Authorization code + PKCE S256 only, resource indicators (RFC 8707), refresh rotation
 *
 * The owner approves each app on a consent screen behind the password gate, and can choose
 * read-only access. Codes and tokens are random 256-bit values stored as SHA-256 hashes.
 * Connectors need a password: without TYMO_PASSWORD there is no owner to consent.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { authEnabled } from "./auth";
import { getDb, schema } from "./db";
import { newId } from "./ids";

export const SCOPE_READ = "library:read";
export const SCOPE_WRITE = "library:write";
export const SCOPES = [SCOPE_READ, SCOPE_WRITE] as const;

const CODE_TTL_MS = 10 * 60_000;
const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_CLIENTS = 200;

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const secret = (prefix: string) => prefix + randomBytes(32).toString("base64url");

/* ------------------------------------------------------------- origins */

/**
 * Public origin for issuer/resource URLs, the same from route handlers, pages and actions
 * (which only see headers). Set TYMO_PUBLIC_URL (e.g. https://tymo.example.com) in
 * production; otherwise trusted forwarded headers are used, and failing that the Host
 * header: http for localhost and IP addresses, https for hostnames (connectors need TLS).
 */
export function publicOrigin(h: Headers): string {
  const configured = process.env.TYMO_PUBLIC_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall through */
    }
  }
  const trust = process.env.TYMO_TRUST_PROXY === "1";
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const host = (trust && first(h.get("x-forwarded-host"))) || first(h.get("host")) || "127.0.0.1";
  const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  const plain = hostname === "localhost" || /^[\d.]+$/.test(hostname) || hostname.includes(":");
  const proto = (trust && first(h.get("x-forwarded-proto"))) || (plain ? "http" : "https");
  return `${proto}://${host}`;
}

export const mcpResource = (origin: string) => `${origin}/mcp`;

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Tymo",
    resource_documentation: `${origin}/settings`,
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...SCOPES],
  };
}

/* ------------------------------------------------------- registration */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Redirect URIs must be https (any host) or http on loopback (desktop apps); no fragments. */
export function validRedirectUri(raw: string): boolean {
  if (raw.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && LOOPBACK.has(u.hostname);
}

const registration = z.object({
  client_name: z.string().trim().max(100).optional(),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

export function requireOwner() {
  if (!authEnabled())
    throw new OAuthError(
      "access_denied",
      "Set TYMO_PASSWORD on the Tymo server to connect remote apps (there must be an owner to approve them).",
      403,
    );
}

export async function registerClient(body: unknown) {
  requireOwner();
  const parsed = registration.safeParse(body);
  if (!parsed.success) throw new OAuthError("invalid_client_metadata", "Invalid client metadata");
  const r = parsed.data;
  const bad = r.redirect_uris.find((u) => !validRedirectUri(u));
  if (bad)
    throw new OAuthError(
      "invalid_redirect_uri",
      "Redirect URIs must use https, or http on localhost",
    );
  if (r.token_endpoint_auth_method && r.token_endpoint_auth_method !== "none")
    throw new OAuthError("invalid_client_metadata", "Only public clients (auth method none)");
  const unsupported = (r.grant_types ?? []).find(
    (g) => g !== "authorization_code" && g !== "refresh_token",
  );
  if (unsupported)
    throw new OAuthError("invalid_client_metadata", `Unsupported grant ${unsupported}`);

  const db = await getDb();
  // Registrations are unauthenticated by design: prune abandoned ones and cap the total.
  await db.run(sql`DELETE FROM oauth_clients WHERE created_at < ${Date.now() - 86_400_000}
    AND id NOT IN (SELECT client_id FROM oauth_grants)`);
  const [{ n } = { n: 0 }] = await db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM oauth_clients`,
  );
  if (n >= MAX_CLIENTS)
    throw new OAuthError("temporarily_unavailable", "Too many registered apps", 429);

  const id = newId();
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const name = r.client_name?.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "Unnamed app";
  await db.insert(schema.oauthClients).values({ id, name, redirectUris: r.redirect_uris });
  return {
    client_id: id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: r.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

/* -------------------------------------------------------- authorization */

export const authorizeParams = z.object({
  response_type: z.string(),
  client_id: z.string().min(1).max(64),
  redirect_uri: z.string().max(2000),
  code_challenge: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  code_challenge_method: z.string().optional(),
  state: z.string().max(1000).optional(),
  scope: z.string().max(200).optional(),
  resource: z.string().max(2000).optional(),
});
export type AuthorizeParams = z.infer<typeof authorizeParams>;

export interface AuthorizeRequest {
  params: AuthorizeParams;
  client: { id: string; name: string };
  redirectHost: string;
  /** Scopes the app asked for (the owner may narrow to read-only). */
  scopes: string[];
}

/**
 * Validates an authorization request. Problems with the client or redirect URI are shown on
 * the page (never redirected, so a bad request can't bounce the owner to an attacker's URL).
 */
export async function checkAuthorizeRequest(
  raw: Record<string, unknown>,
  origin: string,
): Promise<AuthorizeRequest> {
  requireOwner();
  const parsed = authorizeParams.safeParse(raw);
  if (!parsed.success)
    throw new OAuthError("invalid_request", "This sign-in link is incomplete or malformed.");
  const p = parsed.data;
  const db = await getDb();
  const [client] = await db
    .select()
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.id, p.client_id));
  if (!client) throw new OAuthError("invalid_client", "This app isn't registered with Tymo.");
  if (!client.redirectUris.includes(p.redirect_uri))
    throw new OAuthError(
      "invalid_request",
      "The app's return address doesn't match its registration.",
    );
  if (p.response_type !== "code")
    throw new OAuthError(
      "unsupported_response_type",
      "Only the authorization code flow is supported.",
    );
  if ((p.code_challenge_method ?? "") !== "S256")
    throw new OAuthError("invalid_request", "The app must use PKCE with S256.");
  if (p.resource && p.resource.replace(/\/+$/, "") !== mcpResource(origin))
    throw new OAuthError("invalid_target", "The app asked for access to a different server.");
  const asked = (p.scope ?? SCOPES.join(" ")).split(/\s+/).filter(Boolean);
  const scopes = SCOPES.filter((s) => asked.includes(s));
  return {
    params: p,
    client: { id: client.id, name: client.name },
    redirectHost: new URL(p.redirect_uri).host,
    scopes: scopes.length ? scopes : [SCOPE_READ],
  };
}

function withQuery(uri: string, q: Record<string, string | undefined>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(q)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/** The owner's decision → the URL to send the browser back to (code, or access_denied). */
export async function decideAuthorization(
  req: AuthorizeRequest,
  origin: string,
  approve: boolean,
  allowWrite: boolean,
): Promise<string> {
  const { params: p } = req;
  if (!approve)
    return withQuery(p.redirect_uri, { error: "access_denied", state: p.state, iss: origin });
  const scope = [
    SCOPE_READ,
    ...(allowWrite && req.scopes.includes(SCOPE_WRITE) ? [SCOPE_WRITE] : []),
  ];
  const code = secret("tyac_");
  const db = await getDb();
  await db
    .delete(schema.oauthCodes)
    .where(lt(schema.oauthCodes.expiresAt, Date.now() - CODE_TTL_MS));
  await db.insert(schema.oauthCodes).values({
    codeHash: sha256(code),
    clientId: req.client.id,
    redirectUri: p.redirect_uri,
    codeChallenge: p.code_challenge,
    scope: scope.join(" "),
    resource: mcpResource(origin),
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return withQuery(p.redirect_uri, { code, state: p.state, iss: origin });
}

/* ---------------------------------------------------------------- tokens */

function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const expected = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const given = Buffer.from(challenge);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function tokenResponse(access: string, refresh: string, scope: string) {
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: refresh,
    scope,
  };
}

const tokenRequest = z.object({
  grant_type: z.string(),
  code: z.string().max(200).optional(),
  redirect_uri: z.string().max(2000).optional(),
  client_id: z.string().max(64).optional(),
  code_verifier: z.string().max(200).optional(),
  refresh_token: z.string().max(200).optional(),
  resource: z.string().max(2000).optional(),
});

export async function exchangeToken(raw: Record<string, unknown>, origin: string) {
  requireOwner();
  const parsed = tokenRequest.safeParse(raw);
  if (!parsed.success) throw new OAuthError("invalid_request", "Malformed token request");
  const r = parsed.data;
  if (r.resource && r.resource.replace(/\/+$/, "") !== mcpResource(origin))
    throw new OAuthError("invalid_target", "Unknown resource");
  const db = await getDb();
  const now = Date.now();

  if (r.grant_type === "authorization_code") {
    if (!r.code || !r.code_verifier || !r.client_id || !r.redirect_uri)
      throw new OAuthError(
        "invalid_request",
        "code, code_verifier, client_id and redirect_uri are required",
      );
    const [row] = await db
      .select()
      .from(schema.oauthCodes)
      .where(eq(schema.oauthCodes.codeHash, sha256(r.code)));
    if (!row) throw new OAuthError("invalid_grant", "Unknown or expired code");
    if (row.usedAt) {
      // A replayed code means it leaked: revoke whatever it produced (RFC 6749 §4.1.2).
      if (row.grantId)
        await db.delete(schema.oauthGrants).where(eq(schema.oauthGrants.id, row.grantId));
      throw new OAuthError("invalid_grant", "Code already used");
    }
    if (
      row.expiresAt < now ||
      row.clientId !== r.client_id ||
      row.redirectUri !== r.redirect_uri ||
      !pkceMatches(r.code_verifier, row.codeChallenge)
    )
      throw new OAuthError("invalid_grant", "Invalid code, verifier or redirect URI");

    const access = secret("tyat_");
    const refresh = secret("tyrt_");
    const grantId = newId();
    await db.transaction(async (tx) => {
      await tx
        .update(schema.oauthCodes)
        .set({ usedAt: now, grantId })
        .where(eq(schema.oauthCodes.codeHash, row.codeHash));
      await tx.insert(schema.oauthGrants).values({
        id: grantId,
        clientId: row.clientId,
        scope: row.scope,
        resource: row.resource,
        accessHash: sha256(access),
        accessExpiresAt: now + ACCESS_TTL_MS,
        refreshHash: sha256(refresh),
        refreshExpiresAt: now + REFRESH_TTL_MS,
      });
    });
    return tokenResponse(access, refresh, row.scope);
  }

  if (r.grant_type === "refresh_token") {
    if (!r.refresh_token) throw new OAuthError("invalid_request", "refresh_token is required");
    const [grant] = await db
      .select()
      .from(schema.oauthGrants)
      .where(eq(schema.oauthGrants.refreshHash, sha256(r.refresh_token)));
    if (!grant || grant.refreshExpiresAt < now || (r.client_id && r.client_id !== grant.clientId))
      throw new OAuthError("invalid_grant", "Invalid or expired refresh token");
    // Rotation: the old refresh token stops working as soon as a new one is issued.
    const access = secret("tyat_");
    const refresh = secret("tyrt_");
    await db
      .update(schema.oauthGrants)
      .set({
        accessHash: sha256(access),
        accessExpiresAt: now + ACCESS_TTL_MS,
        refreshHash: sha256(refresh),
        refreshExpiresAt: now + REFRESH_TTL_MS,
      })
      .where(eq(schema.oauthGrants.id, grant.id));
    return tokenResponse(access, refresh, grant.scope);
  }

  throw new OAuthError("unsupported_grant_type", "Unsupported grant_type");
}

/** RFC 7009: always succeeds, whether or not the token existed. */
export async function revokeToken(token: string | undefined) {
  if (!token || token.length > 200) return;
  const h = sha256(token);
  const db = await getDb();
  await db
    .delete(schema.oauthGrants)
    .where(
      sql`${schema.oauthGrants.accessHash} = ${h} OR ${schema.oauthGrants.refreshHash} = ${h}`,
    );
}

export interface AccessGrant {
  grantId: string;
  clientId: string;
  scopes: string[];
}

/** Checks an OAuth access token for this server's MCP resource. */
export async function verifyAccessToken(
  token: string | null | undefined,
  origin: string,
): Promise<AccessGrant | null> {
  if (!token?.startsWith("tyat_") || token.length > 200 || !authEnabled()) return null;
  const db = await getDb();
  const [g] = await db
    .select()
    .from(schema.oauthGrants)
    .where(eq(schema.oauthGrants.accessHash, sha256(token)));
  if (!g || g.accessExpiresAt < Date.now() || g.resource !== mcpResource(origin)) return null;
  if (!g.lastUsedAt || Date.now() - g.lastUsedAt > 60_000)
    await db
      .update(schema.oauthGrants)
      .set({ lastUsedAt: Date.now() })
      .where(eq(schema.oauthGrants.id, g.id));
  return { grantId: g.id, clientId: g.clientId, scopes: g.scope.split(" ") };
}

/* -------------------------------------------------------- connected apps */

export async function listConnectedApps() {
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.oauthGrants.id,
      name: schema.oauthClients.name,
      redirectUris: schema.oauthClients.redirectUris,
      scope: schema.oauthGrants.scope,
      createdAt: schema.oauthGrants.createdAt,
      lastUsedAt: schema.oauthGrants.lastUsedAt,
      refreshExpiresAt: schema.oauthGrants.refreshExpiresAt,
    })
    .from(schema.oauthGrants)
    .innerJoin(schema.oauthClients, eq(schema.oauthClients.id, schema.oauthGrants.clientId));
  return rows
    .filter((r) => r.refreshExpiresAt > Date.now())
    .map((r) => ({
      id: r.id,
      name: r.name,
      host: (() => {
        try {
          return new URL(r.redirectUris[0] ?? "").host;
        } catch {
          return "";
        }
      })(),
      canWrite: r.scope.split(" ").includes(SCOPE_WRITE),
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
    }))
    .sort((a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt));
}

export async function disconnectApp(grantId: string) {
  const db = await getDb();
  await db.delete(schema.oauthGrants).where(eq(schema.oauthGrants.id, grantId));
}
