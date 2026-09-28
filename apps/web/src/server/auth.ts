/**
 * Optional password gate for self-hosted deployments (TYMO_PASSWORD).
 * Cookie = "<expiryMs>.<hmac>" signed with a key derived from the password,
 * so changing the password invalidates every session.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "tymo_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function authEnabled() {
  return !!process.env.TYMO_PASSWORD;
}

function key() {
  return createHash("sha256")
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
