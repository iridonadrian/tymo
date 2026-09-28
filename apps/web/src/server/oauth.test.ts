import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import { createSave } from "./saves";
import { createApiToken } from "./tokens";
import {
  checkAuthorizeRequest,
  decideAuthorization,
  disconnectApp,
  listConnectedApps,
  validRedirectUri,
} from "./oauth";
import { POST as register } from "../app/oauth/register/route";
import { POST as token } from "../app/oauth/token/route";
import { POST as revoke } from "../app/oauth/revoke/route";
import { POST as mcp } from "../app/mcp/route";
import { GET as resourceMeta } from "../app/.well-known/oauth-protected-resource/route";
import { GET as serverMeta } from "../app/.well-known/oauth-authorization-server/route";

const ORIGIN = "https://tymo.example.com";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(20) + "-abcdefghijklmnopqrstuvwxyz_0123456789";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const req = (p: string, init: RequestInit = {}) =>
  new Request(ORIGIN + p, {
    ...init,
    headers: { host: "tymo.example.com", ...(init.headers ?? {}) },
  });
const form = (o: Record<string, string>) => ({
  method: "POST",
  body: new URLSearchParams(o).toString(),
  headers: { "content-type": "application/x-www-form-urlencoded" },
});

beforeEach(async () => {
  process.env.TYMO_PASSWORD = "a-long-test-passphrase";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-oauth-"));
  await resetDbForTests(`file:${path.join(dir, "o.db")}`);
});
afterEach(() => {
  delete process.env.TYMO_PASSWORD;
});

async function registerClient(redirect = REDIRECT) {
  const res = await register(
    req("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect] }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

async function authorize(clientId: string, allowWrite = true, scope?: string) {
  const r = await checkAuthorizeRequest(
    {
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      state: "st4te",
      resource: `${ORIGIN}/mcp`,
      ...(scope ? { scope } : {}),
    },
    ORIGIN,
  );
  const url = new URL(await decideAuthorization(r, ORIGIN, true, allowWrite));
  return { code: url.searchParams.get("code")!, url };
}

async function exchange(clientId: string, code: string, verifier = VERIFIER) {
  const res = await token(
    req(
      "/oauth/token",
      form({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
        resource: `${ORIGIN}/mcp`,
      }),
    ),
  );
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

async function rpc(bearer: string | null, method: string, params: unknown = {}) {
  const res = await mcp(
    req("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}

describe("discovery", () => {
  it("publishes resource and authorization server metadata", async () => {
    const pr = await (await resourceMeta(req("/.well-known/oauth-protected-resource"))).json();
    expect(pr).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
    const as = await (await serverMeta(req("/.well-known/oauth-authorization-server"))).json();
    expect(as).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("challenges unauthenticated MCP calls with the metadata location", async () => {
    const r = await rpc(null, "tools/list");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
    const bad = await rpc("tyat_nope", "tools/list");
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });
});

describe("connector flow", () => {
  it("registers, authorizes with PKCE, and serves MCP tools", async () => {
    await createSave({ title: "Rust ownership notes", type: "note", body: "borrowing" });
    const reg = await registerClient();
    expect(reg.status).toBe(201);
    const { code, url } = await authorize(reg.body.client_id!);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("iss")).toBe(ORIGIN);

    const t = await exchange(reg.body.client_id!, code);
    expect(t.status).toBe(200);
    expect(t.body).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(t.body.scope).toBe("library:read library:write");

    const tools = await rpc(t.body.access_token!, "tools/list");
    expect(tools.status).toBe(200);
    const names = tools.json.result.tools.map((x: { name: string }) => x.name);
    expect(names).toEqual(expect.arrayContaining(["search_library", "save_note", "update_save"]));

    const found = await rpc(t.body.access_token!, "tools/call", {
      name: "search_library",
      arguments: { query: "rust" },
    });
    expect(found.json.result.content[0].text).toContain("Rust ownership notes");

    const apps = await listConnectedApps();
    expect(apps).toMatchObject([{ name: "Claude", host: "claude.ai", canWrite: true }]);

    // Disconnecting in Settings kills the token immediately.
    await disconnectApp(apps[0]!.id);
    expect((await rpc(t.body.access_token!, "tools/list")).status).toBe(401);
    expect(await listConnectedApps()).toEqual([]);
  });

  it("gives read-only grants read-only tools", async () => {
    const reg = await registerClient();
    const { code } = await authorize(reg.body.client_id!, false);
    const t = await exchange(reg.body.client_id!, code);
    expect(t.body.scope).toBe("library:read");
    const names = (await rpc(t.body.access_token!, "tools/list")).json.result.tools.map(
      (x: { name: string }) => x.name,
    );
    expect(names).toContain("search_library");
    expect(names).not.toContain("save_note");
    expect(names).not.toContain("update_save");
  });

  it("rejects wrong verifiers, replayed codes (revoking their tokens) and stale refresh tokens", async () => {
    const reg = await registerClient();
    const id = reg.body.client_id!;
    const first = await authorize(id);
    expect((await exchange(id, first.code, "w".repeat(43))).body.error).toBe("invalid_grant");

    const { code } = await authorize(id);
    const t = await exchange(id, code);
    expect(t.status).toBe(200);
    // Replay: refused, and the tokens from the first exchange stop working.
    expect((await exchange(id, code)).body.error).toBe("invalid_grant");
    expect((await rpc(t.body.access_token!, "tools/list")).status).toBe(401);

    const { code: c2 } = await authorize(id);
    const t2 = await exchange(id, c2);
    const refreshed = await token(
      req(
        "/oauth/token",
        form({ grant_type: "refresh_token", refresh_token: t2.body.refresh_token!, client_id: id }),
      ),
    );
    const r2 = (await refreshed.json()) as Record<string, string>;
    expect(refreshed.status).toBe(200);
    expect(r2.access_token).not.toBe(t2.body.access_token);
    expect((await rpc(t2.body.access_token!, "tools/list")).status).toBe(401); // rotated away
    expect((await rpc(r2.access_token!, "tools/list")).status).toBe(200);
    const again = await token(
      req(
        "/oauth/token",
        form({ grant_type: "refresh_token", refresh_token: t2.body.refresh_token!, client_id: id }),
      ),
    );
    expect(again.status).toBe(400);

    await revoke(req("/oauth/revoke", form({ token: r2.refresh_token! })));
    expect((await rpc(r2.access_token!, "tools/list")).status).toBe(401);
  });

  it("validates registrations and authorization requests", async () => {
    expect(validRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(validRedirectUri("http://127.0.0.1:6274/callback")).toBe(true);
    expect(validRedirectUri("http://evil.example/cb")).toBe(false);
    expect(validRedirectUri("javascript:alert(1)")).toBe(false);
    expect(validRedirectUri("https://x.example/cb#frag")).toBe(false);
    expect((await registerClient("http://evil.example/cb")).status).toBe(400);

    const reg = await registerClient();
    const base = {
      response_type: "code",
      client_id: reg.body.client_id!,
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
    };
    await expect(
      checkAuthorizeRequest({ ...base, redirect_uri: "https://evil.example/cb" }, ORIGIN),
    ).rejects.toThrow(/return address/);
    await expect(
      checkAuthorizeRequest({ ...base, code_challenge_method: "plain" }, ORIGIN),
    ).rejects.toThrow(/S256/);
    await expect(
      checkAuthorizeRequest({ ...base, resource: "https://other.example/mcp" }, ORIGIN),
    ).rejects.toThrow(/different server/);
    await expect(checkAuthorizeRequest({ ...base, client_id: "nope" }, ORIGIN)).rejects.toThrow(
      /registered/,
    );
  });

  it("requires a password for connectors, but API tokens still work on /mcp", async () => {
    delete process.env.TYMO_PASSWORD;
    expect((await registerClient()).status).toBe(403);
    const { token: api } = await createApiToken("Claude Code");
    const r = await rpc(api, "tools/list");
    expect(r.status).toBe(200);
    expect(r.json.result.tools.length).toBeGreaterThan(5);
  });
});
