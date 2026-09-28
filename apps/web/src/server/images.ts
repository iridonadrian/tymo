/**
 * Privacy image proxy for favicons and preview images.
 *
 * The browser never contacts third-party sites directly: `/img?u=…` fetches through
 * `safeFetchBytes` (same SSRF controls as metadata extraction), verifies the bytes really
 * are an image, and caches the result on disk under DATA_DIR/cache/img.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { safeFetchBytes } from "./fetcher";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const OK_TTL_MS = 7 * 24 * 3600_000;
const FAIL_TTL_MS = 3600_000;
const MAX_CONCURRENT = 6;
const CACHE_LIMIT_BYTES = 256 * 1024 * 1024;

export type ImageMime =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "image/avif"
  | "image/x-icon"
  | "image/bmp"
  | "image/svg+xml";

/** Identifies an image by its bytes. Declared content types are only used to confirm SVG. */
export function sniffImage(buf: Uint8Array, declaredType = ""): ImageMime | null {
  const b = (i: number) => buf[i] ?? -1;
  const ascii = (from: number, len: number) =>
    String.fromCharCode(...Array.from(buf.subarray(from, from + len)));
  if (b(0) === 0x89 && ascii(1, 3) === "PNG") return "image/png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(4, 4) === "ftyp" && /^avi[fs]$/.test(ascii(8, 4))) return "image/avif";
  if (b(0) === 0 && b(1) === 0 && b(2) === 1 && b(3) === 0) return "image/x-icon";
  if (ascii(0, 2) === "BM" && buf.byteLength > 26) return "image/bmp";
  const head = new TextDecoder().decode(buf.subarray(0, 1024)).trimStart().toLowerCase();
  if ((/svg/i.test(declaredType) || /^(<\?xml|<svg|<!--)/.test(head)) && /<svg[\s>]/.test(head)) {
    return "image/svg+xml";
  }
  return null;
}

function cacheDir() {
  return path.join(config.dataDir, "cache", "img");
}

function keyFor(url: string) {
  return createHash("sha256").update(url).digest("hex");
}

interface CacheMeta {
  ok: boolean;
  mime?: ImageMime;
  fetchedAt: number;
}

export interface ProxiedImage {
  mime: ImageMime;
  data: Uint8Array;
}

async function readCache(key: string): Promise<ProxiedImage | null | undefined> {
  try {
    const meta = JSON.parse(
      await fs.readFile(path.join(cacheDir(), `${key}.json`), "utf8"),
    ) as CacheMeta;
    const age = Date.now() - meta.fetchedAt;
    if (age > (meta.ok ? OK_TTL_MS : FAIL_TTL_MS)) return undefined;
    if (!meta.ok || !meta.mime) return null;
    const data = await fs.readFile(path.join(cacheDir(), key));
    return { mime: meta.mime, data: new Uint8Array(data) };
  } catch {
    return undefined;
  }
}

let writes = 0;

async function writeCache(key: string, img: ProxiedImage | null) {
  try {
    await fs.mkdir(cacheDir(), { recursive: true, mode: 0o700 });
    if (img) await fs.writeFile(path.join(cacheDir(), key), img.data, { mode: 0o600 });
    const meta: CacheMeta = { ok: !!img, mime: img?.mime, fetchedAt: Date.now() };
    await fs.writeFile(path.join(cacheDir(), `${key}.json`), JSON.stringify(meta), {
      mode: 0o600,
    });
    if (++writes % 200 === 0) void pruneImageCache();
  } catch (err) {
    console.warn(`[img] cache write failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** Keeps the cache under CACHE_LIMIT_BYTES by deleting the least recently written entries. */
export async function pruneImageCache(limit = CACHE_LIMIT_BYTES) {
  const dir = cacheDir();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  const entries = (
    await Promise.all(
      names
        .filter((n) => /^[0-9a-f]{64}$/.test(n))
        .map(async (n) => {
          const st = await fs.stat(path.join(dir, n)).catch(() => null);
          return st ? { n, size: st.size, mtime: st.mtimeMs } : null;
        }),
    )
  ).filter((e): e is { n: string; size: number; mtime: number } => !!e);
  let total = entries.reduce((a, e) => a + e.size, 0);
  entries.sort((a, b) => a.mtime - b.mtime);
  for (const e of entries) {
    if (total <= limit) break;
    await fs.rm(path.join(dir, e.n), { force: true });
    await fs.rm(path.join(dir, `${e.n}.json`), { force: true });
    total -= e.size;
  }
}

const inflight = new Map<string, Promise<ProxiedImage | null>>();
let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function fetchImage(url: string): Promise<ProxiedImage | null> {
  try {
    const res = await withSlot(() =>
      safeFetchBytes(url, {
        accept: "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8",
        maxBytes: MAX_IMAGE_BYTES,
      }),
    );
    if (res.status >= 400 || res.truncated || !res.bytes.byteLength) return null;
    const mime = sniffImage(res.bytes, res.contentType);
    return mime ? { mime, data: res.bytes } : null;
  } catch {
    return null;
  }
}

/** Returns the image (from cache when fresh), or null when it can't be fetched or isn't an image. */
export async function getProxiedImage(url: string): Promise<ProxiedImage | null> {
  const key = keyFor(url);
  const cached = await readCache(key);
  if (cached !== undefined) return cached;
  let p = inflight.get(key);
  if (!p) {
    p = fetchImage(url).then(async (img) => {
      await writeCache(key, img);
      return img;
    });
    inflight.set(key, p);
    void p.finally(() => inflight.delete(key));
  }
  return p;
}
