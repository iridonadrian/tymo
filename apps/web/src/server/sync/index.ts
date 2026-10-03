/**
 * Folder sync as the app uses it: turn on/off, status, and the background loop.
 * Settings live in the "sync" setting on this device only (backups drop them, so a restored
 * copy never impersonates this device).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { config } from "../config";
import { getDb } from "../db";
import { getSetting, setSetting } from "../settings";
import { publicErrorMessage } from "../privacy";
import { deriveKey, makeCheck, newSalt, verifyCheck } from "./crypto";
import { SyncEngine } from "./engine";
import { SyncFolder } from "./folder";
import { installTriggers, queueEverything, removeTriggers } from "./triggers";

const stored = z.object({
  enabled: z.boolean(),
  folder: z.string(),
  deviceId: z.string().regex(/^[a-f0-9]{16}$/),
  key: z.string(),
  /** The folder's passphrase check when this device joined; it changes with the passphrase. */
  check: z.string().optional(),
});
type Stored = z.infer<typeof stored>;

export interface SyncStatus {
  enabled: boolean;
  folder: string | null;
  defaultFolder: string | null;
  devices: number;
  /** The other computers this one has seen in the folder, newest activity first. */
  others: { lastChangeAt: number | null }[];
  lastSyncAt: number | null;
  lastError: string | null;
  waiting: number;
  queued: number;
  /** "passphrase": changed on another computer; "gone": the library was removed from the folder. */
  issue: "passphrase" | "gone" | null;
}

const state: {
  engine: SyncEngine | null;
  engineFor: string | null;
  running: Promise<void> | null;
  lastSyncAt: number | null;
  lastError: string | null;
  issue: SyncStatus["issue"];
  timer: NodeJS.Timeout | null;
} = {
  engine: null,
  engineFor: null,
  running: null,
  lastSyncAt: null,
  lastError: null,
  issue: null,
  timer: null,
};

/** iCloud Drive's "Tymo Sync" folder when iCloud Drive is on (macOS). */
export function defaultSyncFolder(): string | null {
  const env = process.env.TYMO_SYNC_DIR?.trim();
  if (env) return path.resolve(env);
  const icloud = path.join(os.homedir(), "Library/Mobile Documents/com~apple~CloudDocs");
  return fs.existsSync(icloud) ? path.join(icloud, "Tymo Sync") : null;
}

async function load(): Promise<Stored | null> {
  const parsed = stored.safeParse(await getSetting("sync"));
  return parsed.success ? parsed.data : null;
}

function filesDir() {
  return path.join(config.dataDir, "files");
}

async function engineFor(s: Stored): Promise<SyncEngine> {
  if (state.engine && state.engineFor === s.deviceId) return state.engine;
  state.engine = new SyncEngine({
    db: await getDb(),
    folder: new SyncFolder(s.folder),
    key: Buffer.from(s.key, "base64"),
    deviceId: s.deviceId,
    filesDir: filesDir(),
  });
  state.engineFor = s.deviceId;
  return state.engine;
}

/** A folder we can safely write into: absolute, not the library itself, not a system root. */
export function checkFolder(input: string): string {
  let raw = input.trim();
  if (raw === "~" || raw.startsWith("~/")) raw = path.join(os.homedir(), raw.slice(1));
  const folder = path.resolve(raw);
  if (!path.isAbsolute(raw) || folder === path.parse(folder).root)
    throw new Error("Choose a folder (full path), for example in iCloud Drive or Google Drive.");
  const data = path.resolve(config.dataDir);
  if (folder === data || folder.startsWith(data + path.sep) || data.startsWith(folder + path.sep))
    throw new Error("The sync folder must be outside Tymo's own data folder.");
  return folder;
}

/**
 * Turns sync on. If the folder already holds a Tymo library, this device joins it (the
 * passphrase must match) and both libraries are merged; otherwise a new one is started.
 */
export async function enableSync(input: { folder: string; passphrase: string }) {
  const folderPath = checkFolder(input.folder);
  if (input.passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
  const folder = new SyncFolder(folderPath);
  let cfg = await folder.readConfig();
  let key: Buffer;
  if (cfg) {
    key = await deriveKey(input.passphrase, Buffer.from(cfg.salt, "base64"));
    if (!verifyCheck(cfg.check, key))
      throw new Error("That passphrase doesn't match the library in this folder.");
  } else {
    const salt = newSalt();
    key = await deriveKey(input.passphrase, salt);
    cfg = {
      app: "tymo",
      format: 1,
      salt: salt.toString("base64"),
      check: makeCheck(key),
      createdAt: Date.now(),
    };
    await folder.writeConfig(cfg);
  }
  await state.running;
  await resetLocalState();
  const s: Stored = {
    enabled: true,
    folder: folderPath,
    deviceId: randomBytes(8).toString("hex"),
    key: key.toString("base64"),
    check: cfg.check,
  };
  await setSetting("sync", s);
  state.engine = null;
  state.issue = null;
  startSyncLoop();
  await syncNow();
  return { joined: (await folder.devices()).some((d) => d !== s.deviceId) };
}

/** Starts this device's sync bookkeeping afresh and queues the whole library to be sent. */
async function resetLocalState() {
  const db = await getDb();
  await db.transaction(
    async (tx) => {
      for (const t of [
        "sync_outbox",
        "sync_versions",
        "sync_aliases",
        "sync_pending",
        "sync_cursors",
      ])
        await tx.run(sql.raw(`DELETE FROM ${t}`));
      await installTriggers(tx);
      await queueEverything(tx);
    },
    { behavior: "immediate" },
  );
}

export type DisableMode = "keep" | "remove" | "erase";

/**
 * Turns sync off on this computer; its library stays as it is. Optionally also:
 * - "remove": takes this computer's changes out of the sync folder (the others keep what
 *   they already have);
 * - "erase": deletes the synced library from the folder; every computer stops syncing and
 *   keeps its own library.
 */
export async function disableSync(mode: DisableMode = "keep") {
  await state.running;
  const s = await load();
  const db = await getDb();
  await removeTriggers(db);
  await db.run(sql`DELETE FROM sync_outbox`);
  await setSetting("sync", null);
  state.engine = null;
  state.lastError = null;
  state.issue = null;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  if (s && mode !== "keep" && fs.existsSync(s.folder)) {
    const folder = new SyncFolder(s.folder);
    if (mode === "remove") await folder.removeDevice(s.deviceId);
    else await folder.eraseAll();
  }
}

/**
 * Re-encrypts the synced library with a new passphrase. The folder is rebuilt from this
 * computer's library; the others ask for the new passphrase and then send theirs again,
 * so nothing they had is lost.
 */
export async function changePassphrase(input: { current: string; next: string }) {
  const s = await load();
  if (!s?.enabled) throw new Error("Sync is off.");
  if (input.next.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
  if (input.next === input.current)
    throw new Error("The new passphrase is the same as the old one.");
  const folder = new SyncFolder(s.folder);
  const cfg = await folder.readConfig();
  if (!cfg) throw new Error("The sync folder isn't available right now.");
  const oldKey = await deriveKey(input.current, Buffer.from(cfg.salt, "base64"));
  if (!verifyCheck(cfg.check, oldKey)) throw new Error("The current passphrase isn't right.");
  // Take in everything the other computers have sent so far.
  await syncNow();
  await state.running;
  const salt = newSalt();
  const key = await deriveKey(input.next, salt);
  const next = {
    app: "tymo" as const,
    format: 1 as const,
    salt: salt.toString("base64"),
    check: makeCheck(key),
    createdAt: Date.now(),
  };
  await folder.eraseData();
  await folder.writeConfig(next);
  await resetLocalState();
  await setSetting("sync", {
    ...s,
    deviceId: randomBytes(8).toString("hex"),
    key: key.toString("base64"),
    check: next.check,
  } satisfies Stored);
  state.engine = null;
  state.issue = null;
  await syncNow();
}

/** The folder still holds the library this device joined, with the same passphrase. */
async function checkLibrary(s: Stored) {
  const cfg = await new SyncFolder(s.folder).readConfig();
  if (!cfg) {
    state.issue = "gone";
    throw new Error(
      "The synced library was removed from this folder. Turn sync off, or turn it on again to start a new one.",
    );
  }
  if (s.check === cfg.check) return;
  if (verifyCheck(cfg.check, Buffer.from(s.key, "base64"))) {
    await setSetting("sync", { ...s, check: cfg.check } satisfies Stored);
    return;
  }
  state.issue = "passphrase";
  throw new Error(
    "The passphrase was changed on another computer. Enter the new one to keep syncing.",
  );
}

/** Sends this device's changes and applies everyone else's. Never runs twice at once. */
export function syncNow(): Promise<void> {
  state.running ??= (async () => {
    try {
      const s = await load();
      if (!s?.enabled) return;
      if (!fs.existsSync(s.folder)) throw new Error("The sync folder isn't available right now.");
      await checkLibrary(s);
      state.issue = null;
      const engine = await engineFor(s);
      await engine.exportChanges();
      await engine.importChanges();
      state.lastSyncAt = Date.now();
      state.lastError = null;
    } catch (err) {
      state.lastError = publicErrorMessage(err, "Sync failed");
    } finally {
      state.running = null;
    }
  })();
  return state.running;
}

export async function syncStatus(): Promise<SyncStatus> {
  const s = await load();
  const db = await getDb();
  const folder = s?.enabled ? new SyncFolder(s.folder) : null;
  const others = folder
    ? (
        await Promise.all(
          (await folder.devices())
            .filter((d) => d !== s!.deviceId)
            .map(async (d) => ({ lastChangeAt: await folder.lastChange(d) })),
        )
      ).sort((a, b) => (b.lastChangeAt ?? 0) - (a.lastChangeAt ?? 0))
    : [];
  const count = async (table: string) =>
    (await db.all<{ n: number }>(sql.raw(`SELECT count(*) AS n FROM ${table}`)))[0]?.n ?? 0;
  return {
    enabled: !!s?.enabled,
    folder: s?.folder ?? null,
    defaultFolder: defaultSyncFolder(),
    devices: others.length + (s?.enabled ? 1 : 0),
    others,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError,
    waiting: await count("sync_pending"),
    queued: await count("sync_outbox"),
    issue: s?.enabled ? state.issue : null,
  };
}

/** Every 15 seconds while sync is on. Called at startup and when sync is turned on. */
export function startSyncLoop() {
  if (state.timer) return;
  state.timer = setInterval(() => void syncNow(), 15_000);
  state.timer.unref?.();
}

/** Startup: refresh triggers for the current columns, or make sure none are left behind. */
export async function initSync() {
  const db = await getDb();
  const s = await load();
  if (s?.enabled) {
    await installTriggers(db);
    startSyncLoop();
    setTimeout(() => void syncNow(), 3000).unref?.();
  } else {
    await removeTriggers(db);
  }
}
