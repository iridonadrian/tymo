/** URL helpers shared by server, UI and extension. Pure functions only. */

export function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function isHttpUrl(raw: string): boolean {
  const u = parseUrl(raw);
  return !!u && (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
}

/**
 * Returns the URL only if it is safe to put in an href/src (http/https).
 * Anything else — javascript:, data:, vbscript:, relative junk — becomes undefined.
 */
export function safeHref(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  return isHttpUrl(raw) ? new URL(raw).toString() : undefined;
}

/** Human-friendly domain: lowercase host without leading "www.". */
export function domainOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const u = parseUrl(raw);
  if (!u || !u.hostname) return null;
  return u.hostname.toLowerCase().replace(/^www\./, "");
}

const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^msclkid$/i,
  /^mc_(cid|eid)$/i,
  /^igshid$/i,
  /^ref_src$/i,
  /^_hs(enc|mi)$/i,
  /^yclid$/i,
  /^si$/i,
];

/** Removes well-known tracking parameters. Keeps everything else intact. */
export function stripTracking(raw: string): string {
  const u = parseUrl(raw);
  if (!u) return raw;
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
  }
  return u.toString();
}

/**
 * Canonical form used for duplicate detection only (never shown to users):
 * lowercase scheme+host, no www, no default port, no hash, no tracking params,
 * sorted query, no trailing slash.
 */
export function normalizeUrl(raw: string): string | null {
  const u = parseUrl(stripTracking(raw));
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const port = u.port && !["80", "443"].includes(u.port) ? `:${u.port}` : "";
  const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? "?" + new URLSearchParams(params).toString() : "";
  let path = u.pathname.replace(/\/+$/, "");
  if (!path) path = "";
  return `${host}${port}${path}${query}`;
}

/** Resolves a possibly-relative URL against a base; only http(s) results survive. */
export function resolveHttpUrl(raw: string | null | undefined, base: string): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw.trim(), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort fallback title for a URL with no metadata. */
export function titleFromUrl(raw: string): string {
  const u = parseUrl(raw);
  if (!u) return raw;
  const host = u.hostname.replace(/^www\./, "");
  const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return last ? `${last} — ${host}` : host;
}

/** Removes boilerplate from well-known page titles ("GitHub - owner/repo: long description"). */
export function cleanTitle(title: string, rawUrl?: string | null): string {
  let t = title.trim();
  const host = rawUrl ? (parseUrl(rawUrl)?.hostname.replace(/^www\./, "") ?? "") : "";
  if (host === "github.com") {
    const m = /^GitHub\s+-\s+([\w.-]+\/[\w.-]+)(?::\s.*)?$/.exec(t);
    if (m) t = m[1]!;
  }
  return t;
}
