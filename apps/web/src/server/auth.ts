/**
 * Optional password gate for self-hosted deployments (TYMO_PASSWORD).
 * Cookie = "<expiryMs>.<hmac>". The HMAC key mixes a random per-install secret
 * (DATA_DIR/session.key, never in backups) with the password, so:
 *  - a stolen cookie can't be used to guess the password offline, and
 *  - changing the password (or deleting session.key) still signs everyone out.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

export const SESSION_COOKIE = "tymo_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function authEnabled() {
  return !!process.env.TYMO_PASSWORD;
}

let secret: Buffer | null = null;

/** Loads DATA_DIR/session.key, creating it on first use. */
function sessionSecret(): Buffer {
  if (secret) return secret;
  const file = path.join(config.dataDir, "session.key");
  try {
    const existing = fs.readFileSync(file);
    if (existing.length >= 32) return (secret = existing);
  } catch {
    /* not created yet */
  }
  const fresh = randomBytes(32);
  try {
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    // "wx": if another process created it first, use theirs.
    fs.writeFileSync(file, fresh, { mode: 0o600, flag: "wx" });
    secret = fresh;
  } catch {
    try {
      const existing = fs.readFileSync(file);
      secret = existing.length >= 32 ? existing : fresh;
    } catch {
      // Read-only data folder: sessions last until the server restarts.
      secret = fresh;
    }
  }
  return secret;
}

function key() {
  return createHmac("sha256", sessionSecret())
    .update("tymo-session\0" + (process.env.TYMO_PASSWORD ?? ""))
    .digest();
}

function sign(payload: string) {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export function issueSessionCookie(now = Date.now()) {
  const exp = String(now + SESSION_TTL_MS);
  return `${exp}.${sign(exp)}`;
}

export function verifySessionCookie(value: string | undefined, now = Date.now()): boolean {
  if (!value || !authEnabled()) return false;
  const [exp, mac] = value.split(".");
  if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  const expected = Buffer.from(sign(exp));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function checkPassword(input: string): boolean {
  const expected = createHash("sha256")
    .update(process.env.TYMO_PASSWORD ?? "")
    .digest();
  const given = createHash("sha256").update(input).digest();
  return authEnabled() && timingSafeEqual(expected, given);
}
