/**
 * Keeps machine details out of anything that leaves the server: error messages shown in the
 * UI or API responses never contain absolute paths (which reveal usernames and folders),
 * and client IPs are only taken from proxy headers when the operator says a proxy sets them.
 */
import os from "node:os";
import path from "node:path";
import { config } from "./config";

/** Shortens a path for display: the home directory becomes "~". */
export function displayPath(p: string): string {
  const home = os.homedir();
  return home && (p === home || p.startsWith(home + path.sep)) ? "~" + p.slice(home.length) : p;
}

/**
 * A message that is safe to show a client. System errors (ENOENT, EACCES, …) and anything
 * mentioning a local path collapse to a generic message; details stay in the server log.
 */
export function publicErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (!(err instanceof Error)) return fallback;
  const code = (err as NodeJS.ErrnoException).code;
  if (typeof code === "string" && /^E[A-Z]+$/.test(code)) {
    console.error("[error]", err);
    return `${fallback} (${code})`;
  }
  let msg = err.message;
  for (const p of [config.dataDir, config.migrationsDir, process.cwd(), os.homedir()]) {
    if (p && p.length > 1) msg = msg.split(p).join("…");
  }
  // Any remaining absolute POSIX/Windows path.
  msg = msg.replace(/(?:[A-Za-z]:\\|\/)(?:[\w.-]+[\\/])+[\w.-]*/g, "…");
  return msg.slice(0, 300) || fallback;
}

/**
 * Client IP for rate limiting. X-Forwarded-For is trivially spoofable unless a reverse proxy
 * overwrites it, so it is only honoured with TYMO_TRUST_PROXY=1; otherwise all clients share
 * one bucket (safe: brute force stays capped, at worst logins are briefly throttled).
 */
export function clientIp(headers: Headers): string {
  if (process.env.TYMO_TRUST_PROXY !== "1") return "direct";
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "direct"
  );
}
