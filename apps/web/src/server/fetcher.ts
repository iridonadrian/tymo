/**
 * SSRF-hardened HTTP client for metadata extraction. See docs/THREAT_MODEL.md.
 *
 * - static URL policy (scheme, credentials, ports, local hostnames, IP literals)
 * - every DNS answer validated in the socket lookup hook → the checked IP is the connected IP
 * - manual redirects, each hop re-validated
 * - total timeout, body size cap, content-type allow-list, no cookies/credentials
 */
import dns from "node:dns";
import type { LookupAddress } from "node:dns";
import { Agent, fetch } from "undici";
import { checkFetchUrl, isPublicAddress } from "@tymo/core/net";
import { config } from "./config";

export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_BODY_BYTES = 1.5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
// Generic on purpose: no repository URL, owner name or version details leak to fetched sites.
const USER_AGENT = "Mozilla/5.0 (compatible; Tymo)";

export class FetchBlockedError extends Error {}

type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCb) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = (addresses as LookupAddress[]).filter(
      (a) => config.allowPrivateFetch || isPublicAddress(a.address),
    );
    if (!list.length) {
      return callback(
        Object.assign(new FetchBlockedError(`Blocked private address for ${hostname}`), {
          code: "EBLOCKED",
        }),
        "",
      );
    }
    if (options.all) return callback(null, list);
    const wanted =
      options.family === 4 || options.family === 6
        ? list.find((a) => a.family === options.family)
        : list[0];
    if (!wanted) return callback(Object.assign(new Error("No address"), { code: "ENOTFOUND" }), "");
    callback(null, wanted.address, wanted.family);
  });
}

const agent = new Agent({
  connect: { lookup: safeLookup as never, timeout: 5_000 },
  headersTimeout: FETCH_TIMEOUT_MS,
  bodyTimeout: FETCH_TIMEOUT_MS,
  maxResponseSize: MAX_BODY_BYTES * 4,
  connections: 16,
});

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  html: string | null;
}

function validate(url: string): URL {
  const check = checkFetchUrl(url);
  if (check.ok) return check.url;
  if (
    config.allowPrivateFetch &&
    /private|local|single-label/i.test(check.reason) &&
    /^https?:/.test(url)
  ) {
    return new URL(url);
  }
  throw new FetchBlockedError(check.reason);
}

async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(total, max));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, out.byteLength - off);
    out.set(c.subarray(0, take), off);
    off += take;
    if (off >= out.byteLength) break;
  }
  return out;
}

function decode(bytes: Uint8Array, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  for (const label of [fromHeader, fromMeta, "utf-8"]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      /* unknown label → try the next */
    }
  }
  return new TextDecoder().decode(bytes);
}

type HopResult = { url: URL; res: Awaited<ReturnType<typeof fetch>> };

/** Follows redirects manually, re-validating every hop against the URL policy. */
async function fetchValidated(
  rawUrl: string,
  accept: string,
  signal: AbortSignal,
): Promise<HopResult> {
  let url = validate(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      dispatcher: agent,
      redirect: "manual",
      signal,
      credentials: "omit",
      headers: {
        "user-agent": USER_AGENT,
        accept,
        "accept-language": "en;q=0.9,*;q=0.5",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new Error(`Redirect without location (${res.status})`);
      url = validate(new URL(loc, url).toString());
      continue;
    }
    return { url, res };
  }
  throw new FetchBlockedError("Too many redirects");
}

export async function safeFetch(rawUrl: string): Promise<SafeFetchResult> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const { url, res } = await fetchValidated(
    rawUrl,
    "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
    signal,
  );
  const contentType = res.headers.get("content-type") ?? "";
  const isHtml = /^(text\/html|application\/xhtml\+xml)/i.test(contentType);
  if (!isHtml) {
    await res.body?.cancel().catch(() => {});
    return { finalUrl: url.toString(), status: res.status, contentType, html: null };
  }
  const bytes = await readCapped(res.body as ReadableStream<Uint8Array> | null, MAX_BODY_BYTES);
  return {
    finalUrl: url.toString(),
    status: res.status,
    contentType,
    html: decode(bytes, contentType),
  };
}

export interface SafeFetchBytesResult {
  finalUrl: string;
  status: number;
  contentType: string;
  bytes: Uint8Array;
  /** True when the body was longer than `maxBytes` and got cut off. */
  truncated: boolean;
}

/** Same SSRF controls as `safeFetch`, but returns raw bytes (images, archived pages). */
export async function safeFetchBytes(
  rawUrl: string,
  opts: { accept: string; maxBytes: number },
): Promise<SafeFetchBytesResult> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const { url, res } = await fetchValidated(rawUrl, opts.accept, signal);
  const contentType = res.headers.get("content-type") ?? "";
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > opts.maxBytes) {
    await res.body?.cancel().catch(() => {});
    return {
      finalUrl: url.toString(),
      status: res.status,
      contentType,
      bytes: new Uint8Array(),
      truncated: true,
    };
  }
  const bytes = await readCapped(res.body as ReadableStream<Uint8Array> | null, opts.maxBytes + 1);
  const truncated = bytes.byteLength > opts.maxBytes;
  return {
    finalUrl: url.toString(),
    status: res.status,
    contentType,
    bytes: truncated ? bytes.subarray(0, opts.maxBytes) : bytes,
    truncated,
  };
}
