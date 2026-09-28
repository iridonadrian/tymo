import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { config } from "./config";
import { getDb, schema } from "./db";
import { newId } from "./ids";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

export type AllowedMime =
  "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "application/pdf";

/** Page archives are the only HTML Tymo stores; they are produced by `rewriteForArchive`. */
export const SNAPSHOT_MIME = "text/html; charset=utf-8";

/** Identifies a file by its magic bytes. Declared types and extensions are never trusted. */
export function sniffMime(buf: Uint8Array): AllowedMime | null {
  const b = (i: number) => buf[i] ?? -1;
  if (
    b(0) === 0x89 &&
    b(1) === 0x50 &&
    b(2) === 0x4e &&
    b(3) === 0x47 &&
    b(4) === 0x0d &&
    b(5) === 0x0a
  )
    return "image/png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38) return "image/gif";
  if (
    b(0) === 0x52 &&
    b(1) === 0x49 &&
    b(2) === 0x46 &&
    b(3) === 0x46 &&
    b(8) === 0x57 &&
    b(9) === 0x45 &&
    b(10) === 0x42 &&
    b(11) === 0x50
  ) {
    return "image/webp";
  }
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46 && b(4) === 0x2d)
    return "application/pdf";
  return null;
}

function filesDir() {
  return path.join(config.dataDir, "files");
}

/** Storage keys are server-generated ids: never derived from user input, so no traversal. */
function keyPath(key: string) {
  if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error("Invalid storage key");
  return path.join(filesDir(), key);
}

export async function storeFile(
  data: Uint8Array,
  opts: {
    saveId: string;
    kind: "upload" | "screenshot" | "snapshot";
    originalName?: string;
    maxBytes?: number;
  },
) {
  const max = opts.maxBytes ?? MAX_UPLOAD_BYTES;
  if (data.byteLength === 0) throw new Error("Empty file");
  if (data.byteLength > max) throw new Error(`File exceeds ${Math.round(max / 1024 / 1024)} MB`);
  const mime = opts.kind === "snapshot" ? SNAPSHOT_MIME : sniffMime(data);
  if (!mime) throw new Error("Unsupported file type. Allowed: PNG, JPEG, GIF, WebP, PDF.");
  const id = newId();
  const storageKey = newId();
  await fs.mkdir(filesDir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(keyPath(storageKey), data, { mode: 0o600, flag: "wx" });
  const db = await getDb();
  await db.insert(schema.files).values({
    id,
    saveId: opts.saveId,
    kind: opts.kind,
    mime,
    size: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
    storageKey,
    originalName: opts.originalName?.slice(0, 255) ?? null,
  });
  return { id, mime };
}

export async function readStoredFile(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.files).where(eq(schema.files.id, id));
  if (!row) return null;
  try {
    const data = await fs.readFile(keyPath(row.storageKey));
    return { row, data };
  } catch {
    return null;
  }
}

export async function deleteStoredFiles(keys: string[]) {
  await Promise.all(keys.map((k) => fs.rm(keyPath(k), { force: true }).catch(() => {})));
}
