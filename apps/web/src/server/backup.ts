/**
 * Full backups: a consistent SQLite snapshot (VACUUM INTO) plus every stored file, streamed
 * as tar.gz. Restore streams an archive into a staging folder, validates it, then swaps it in
 * with the database closed. The previous data is kept in DATA_DIR/.pre-restore-<time>/.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import {
  isSafeTarName,
  parseTarHeader,
  TAR_BLOCK,
  TAR_END,
  tarHeader,
  tarPadding,
} from "@tymo/core/tar";
import { config } from "./config";
import { currentDbPath, getDb, schema, withDatabaseClosed } from "./db";
import { invalidateVectorCache } from "./embeddings";
import { newId } from "./ids";
import { getSetting, setSetting } from "./settings";

const FILE_NAME = /^files\/[0-9a-f-]{36}$/;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ENTRIES = 500_000;

export interface BackupManifest {
  app: "tymo";
  format: 1;
  version: string;
  createdAt: number;
  files: number;
}

function filesDir() {
  return path.join(config.dataDir, "files");
}

async function* backupChunks(snapshot: string, fileKeys: string[], manifest: BackupManifest) {
  const m = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  yield tarHeader("manifest.json", m.byteLength, manifest.createdAt);
  yield m;
  yield new Uint8Array(tarPadding(m.byteLength));

  const entries: [string, string][] = [
    ["tymo.db", snapshot],
    ...fileKeys.map((k): [string, string] => [`files/${k}`, path.join(filesDir(), k)]),
  ];
  for (const [name, file] of entries) {
    let st: fs.Stats;
    try {
      st = await fsp.stat(file);
    } catch {
      continue; // a file row whose blob went missing: skip rather than fail the whole backup
    }
    yield tarHeader(name, st.size, st.mtimeMs);
    let written = 0;
    for await (const chunk of fs.createReadStream(file)) {
      const c = chunk as Buffer;
      // Never write more than the header promised, even if the file grows meanwhile.
      const take = c.subarray(0, Math.max(0, st.size - written));
      written += take.byteLength;
      if (take.byteLength) yield new Uint8Array(take);
    }
    if (written < st.size) yield new Uint8Array(st.size - written);
    yield new Uint8Array(tarPadding(st.size));
  }
  yield TAR_END;
}

/** Streams a .tar.gz backup of the whole library. */
/**
 * Backups are files people copy around, so they never carry the AI provider's API key
 * (re-enter it after a restore, or keep it in TYMO_AI_API_KEY). API tokens are stored as
 * hashes only and stay, so the browser extension keeps working after a restore.
 */
async function scrubSecrets(dbFile: string) {
  const client = createClient({ url: "file:" + dbFile });
  try {
    // Overwrite, don't just unlink, the old value's bytes inside the file.
    await client.execute("PRAGMA secure_delete = ON");
    await client.execute(
      "UPDATE settings SET value = json_set(value, '$.apiKey', '') WHERE key = 'ai' AND json_valid(value)",
    );
  } finally {
    client.close();
  }
}

export async function createBackup(): Promise<{
  stream: ReadableStream<Uint8Array>;
  name: string;
}> {
  if (!currentDbPath()) throw new Error("Backups need a local SQLite database file");
  const db = await getDb();
  await fsp.mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const snapshot = path.join(config.dataDir, `.backup-${newId()}.db`);
  await db.run(sql`VACUUM INTO ${snapshot}`);
  await scrubSecrets(snapshot);
  const keys = (await db.select({ key: schema.files.storageKey }).from(schema.files)).map(
    (r) => r.key,
  );
  const createdAt = Date.now();
  const manifest: BackupManifest = {
    app: "tymo",
    format: 1,
    version: config.version,
    createdAt,
    files: keys.length,
  };
  const cleanup = () => fsp.rm(snapshot, { force: true }).catch(() => {});
  const iter = backupChunks(snapshot, keys, manifest);
  const tar = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      try {
        const { done, value } = await iter.next();
        if (done) {
          ctrl.close();
          await cleanup();
        } else if (value.byteLength) ctrl.enqueue(value);
      } catch (err) {
        ctrl.error(err);
        await cleanup();
      }
    },
    async cancel() {
      await iter.return(undefined);
      await cleanup();
    },
  });
  const date = new Date(createdAt).toISOString().slice(0, 10);
  return {
    stream: tar.pipeThrough(
      new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>,
    ),
    name: `tymo-backup-${date}.tar.gz`,
  };
}

/** Streams a tar archive into `dir`, enforcing the backup layout. Returns the manifest. */
async function extract(stream: ReadableStream<Uint8Array>, dir: string) {
  let buf = new Uint8Array(0);
  let entry: {
    name: string;
    left: number;
    pad: number;
    fh: fsp.FileHandle | null;
    chunks?: Uint8Array[];
  } | null = null;
  let entries = 0;
  let manifest: unknown = null;
  let sawDb = false;
  let ended = false;

  const take = (n: number) => {
    const out = buf.subarray(0, n);
    buf = buf.subarray(n);
    return out;
  };

  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value?.byteLength) {
        const next = new Uint8Array(buf.byteLength + value.byteLength);
        next.set(buf);
        next.set(value, buf.byteLength);
        buf = next;
      }
      // Process as much of the buffer as possible.
      for (;;) {
        if (ended) break;
        if (entry) {
          if (entry.left > 0) {
            if (!buf.byteLength) break;
            const part = take(Math.min(entry.left, buf.byteLength));
            entry.left -= part.byteLength;
            if (entry.fh) await entry.fh.write(part);
            else entry.chunks!.push(part.slice());
            if (entry.left > 0) break;
          }
          if (buf.byteLength < entry.pad) break;
          take(entry.pad);
          if (entry.fh) await entry.fh.close();
          else manifest = JSON.parse(Buffer.concat(entry.chunks!).toString("utf8"));
          entry = null;
          continue;
        }
        if (buf.byteLength < TAR_BLOCK) break;
        const h = parseTarHeader(take(TAR_BLOCK).slice());
        if (h === "end") {
          ended = true;
          break;
        }
        if (++entries > MAX_ENTRIES) throw new Error("Backup has too many entries");
        if (h.type !== "0") throw new Error(`Unsupported entry in backup: ${h.name}`);
        if (!isSafeTarName(h.name)) throw new Error(`Unsafe path in backup: ${h.name}`);
        const isManifest = h.name === "manifest.json";
        if (!isManifest && h.name !== "tymo.db" && !FILE_NAME.test(h.name))
          throw new Error(`Unexpected file in backup: ${h.name}`);
        if (h.size > (isManifest ? MAX_MANIFEST_BYTES : MAX_ENTRY_BYTES))
          throw new Error(`Entry too large: ${h.name}`);
        if (h.name === "tymo.db") sawDb = true;
        entry = {
          name: h.name,
          left: h.size,
          pad: tarPadding(h.size),
          fh: isManifest ? null : await fsp.open(path.join(dir, h.name), "wx", 0o600),
          chunks: isManifest ? [] : undefined,
        };
      }
      if (done || ended) break;
    }
  } finally {
    await entry?.fh?.close().catch(() => {});
    await reader.cancel().catch(() => {});
  }
  if (entry || !ended) throw new Error("The backup file is incomplete");
  const m = manifest as Partial<BackupManifest> | null;
  if (!m || m.app !== "tymo" || m.format !== 1) throw new Error("This is not a Tymo backup");
  if (!sawDb) throw new Error("The backup contains no database");
  return m as BackupManifest;
}

async function validateDb(file: string) {
  const client = createClient({ url: "file:" + file });
  try {
    const ok = await client.execute("PRAGMA quick_check");
    if (String(ok.rows[0]?.[0]) !== "ok") throw new Error("The backup database is damaged");
    const t = await client.execute(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('saves','collections','tags','files')",
    );
    if (Number(t.rows[0]?.[0]) !== 4) throw new Error("The backup database is not a Tymo library");
    const s = await client.execute("SELECT count(*) FROM saves");
    return Number(s.rows[0]?.[0] ?? 0);
  } catch (err) {
    if (err instanceof Error && /damaged|not a Tymo/.test(err.message)) throw err;
    throw new Error("The backup database can't be opened");
  } finally {
    client.close();
  }
}

/** Replaces the whole library with a backup. The previous data is moved aside, not deleted. */
export async function restoreBackup(stream: ReadableStream<Uint8Array>) {
  const dbPath = currentDbPath();
  if (!dbPath) throw new Error("Restore needs a local SQLite database file");
  const staging = path.join(config.dataDir, `.restore-${newId()}`);
  await fsp.mkdir(path.join(staging, "files"), { recursive: true, mode: 0o700 });
  try {
    let manifest: BackupManifest;
    try {
      manifest = await extract(
        stream.pipeThrough(
          new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>,
        ),
        staging,
      );
    } catch (err) {
      // Decompression failures surface as bare TypeErrors; say something useful instead.
      if (err instanceof TypeError || !(err instanceof Error) || !err.message)
        throw new Error("This file is not a Tymo backup (.tar.gz)");
      throw err;
    }
    const saves = await validateDb(path.join(staging, "tymo.db"));
    const aside = path.join(
      config.dataDir,
      `.pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    );

    await withDatabaseClosed(async () => {
      await fsp.mkdir(aside, { recursive: true, mode: 0o700 });
      for (const suffix of ["", "-wal", "-shm"]) {
        await fsp.rename(dbPath + suffix, path.join(aside, "tymo.db" + suffix)).catch(() => {});
      }
      await fsp.rename(filesDir(), path.join(aside, "files")).catch(() => {});
      await fsp.rename(path.join(staging, "tymo.db"), dbPath);
      await fsp.rename(path.join(staging, "files"), filesDir());
    });
    invalidateVectorCache();
    // Keep only the most recent pre-restore copy.
    for (const d of await fsp.readdir(config.dataDir)) {
      const full = path.join(config.dataDir, d);
      if (d.startsWith(".pre-restore-") && full !== aside)
        await fsp.rm(full, { recursive: true, force: true });
    }
    return {
      saves,
      files: manifest.files,
      backupCreatedAt: manifest.createdAt,
      previousDataAt: aside,
    };
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

/** Test/CLI helper: turn a Node stream into a web stream. */
export function toWebStream(s: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(s as Readable) as ReadableStream<Uint8Array>;
}

/* ------------------------------------------------------ scheduled backups */

export const backupSettingsSchema = z.object({
  /** Write a backup to DATA_DIR/backups once a day. */
  auto: z.boolean().default(false),
  keep: z.number().int().min(1).max(90).default(7),
});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;

export async function getBackupSettings(): Promise<BackupSettings> {
  const parsed = backupSettingsSchema.safeParse((await getSetting("backup")) ?? {});
  const s = parsed.success ? parsed.data : backupSettingsSchema.parse({});
  const env = process.env.TYMO_AUTO_BACKUP;
  return { ...s, auto: env ? env === "1" : s.auto };
}

export async function saveBackupSettings(input: Partial<BackupSettings>) {
  const cur = backupSettingsSchema.parse((await getSetting("backup")) ?? {});
  await setSetting("backup", backupSettingsSchema.parse({ ...cur, ...input }));
}

const BACKUP_NAME = /^tymo-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.tar\.gz$/;

/**
 * Where scheduled backups go. Point TYMO_BACKUP_DIR at a synced or external folder (iCloud
 * Drive, Dropbox, Google Drive, a USB disk) so a copy always lives off this machine.
 */
export function backupsDir() {
  const dir = process.env.TYMO_BACKUP_DIR?.trim();
  return dir ? path.resolve(dir) : path.join(config.dataDir, "backups");
}

export async function listBackups() {
  let names: string[] = [];
  try {
    names = await fsp.readdir(backupsDir());
  } catch {
    return [];
  }
  const out = await Promise.all(
    names
      .filter((n) => BACKUP_NAME.test(n))
      .map(async (name) => {
        const st = await fsp.stat(path.join(backupsDir(), name));
        return { name, size: st.size, createdAt: st.mtimeMs };
      }),
  );
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Absolute path of a stored backup, or null for anything that isn't one (no traversal). */
export function storedBackupPath(name: string): string | null {
  return BACKUP_NAME.test(name) ? path.join(backupsDir(), name) : null;
}

/** Writes a backup file now and prunes old ones. */
export async function writeBackupFile(keep?: number) {
  const { stream } = await createBackup();
  await fsp.mkdir(backupsDir(), { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `tymo-backup-${stamp}.tar.gz`;
  const tmp = path.join(backupsDir(), `.${name}.part`);
  await pipeline(
    Readable.fromWeb(stream as import("node:stream/web").ReadableStream<Uint8Array>),
    fs.createWriteStream(tmp, { mode: 0o600 }),
  );
  await fsp.rename(tmp, path.join(backupsDir(), name));
  const limit = keep ?? (await getBackupSettings()).keep;
  for (const old of (await listBackups()).slice(limit)) {
    await fsp.rm(path.join(backupsDir(), old.name), { force: true });
  }
  return name;
}

/** Called hourly: writes a backup when automatic backups are on and the last is ≥ 24 h old. */
export async function maybeScheduledBackup(now = Date.now()) {
  const s = await getBackupSettings();
  if (!s.auto || !currentDbPath()) return null;
  const [latest] = await listBackups();
  if (latest && now - latest.createdAt < 23.5 * 3600_000) return null;
  return writeBackupFile(s.keep);
}
