import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../config";
import { getDb, resetDbForTests, schema } from "../db";
import { createSave, updateSave } from "../saves";
import { createBackup } from "../backup";
import { getSetting } from "../settings";
import { deriveKey } from "./crypto";
import { SyncEngine } from "./engine";
import { SyncFolder } from "./folder";
import { installTriggers } from "./triggers";
import { disableSync, enableSync, syncNow, syncStatus } from ".";

let folder: string;

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-sync-svc-"));
  await resetDbForTests(`file:${path.join(dir, "t.db")}`);
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-sync-icloud-"));
});

/** A second computer reading the same folder. */
async function otherComputer(passphrase: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-sync-other-"));
  const client = createClient({ url: `file:${path.join(dir, "o.db")}` });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: config.migrationsDir });
  await installTriggers(db);
  const sf = new SyncFolder(folder);
  const cfg = (await sf.readConfig())!;
  const key = await deriveKey(passphrase, Buffer.from(cfg.salt, "base64"));
  const engine = new SyncEngine({
    db,
    folder: sf,
    key,
    deviceId: "eeeeeeeeeeeeeeee",
    filesDir: path.join(dir, "files"),
  });
  return { db, engine, close: () => client.close() };
}

describe("sync in the app", () => {
  it("sends saves made through the app, existing ones included, to another computer", async () => {
    const before = await createSave({ url: "https://example.org/old", title: "Saved before sync" });
    const r = await enableSync({ folder, passphrase: "a long passphrase" });
    expect(r.joined).toBe(false);
    const after = await createSave({
      url: "https://example.org/new",
      title: "Saved after",
      tags: ["x"],
    });
    await updateSave(before.id, { notes: "edited" });
    await syncNow();
    const status = await syncStatus();
    expect(status).toMatchObject({ enabled: true, devices: 1, lastError: null, queued: 0 });

    const other = await otherComputer("a long passphrase");
    await other.engine.importChanges();
    const rows = await other.db.all<{ id: string; title: string; notes: string | null }>(
      sql`SELECT id, title, notes FROM saves ORDER BY title`,
    );
    expect(rows).toEqual([
      { id: after.id, title: "Saved after", notes: null },
      { id: before.id, title: "Saved before sync", notes: "edited" },
    ]);
    other.close();
  });

  it("receives changes from another computer and makes them searchable here", async () => {
    await enableSync({ folder, passphrase: "a long passphrase" });
    const other = await otherComputer("a long passphrase");
    await other.db.run(sql`INSERT INTO saves (id, seq, title, url, normalized_url)
      VALUES ('remote-1', 1, 'Kyoto travel notes', 'https://kyoto.example/', 'https://kyoto.example/')`);
    await other.engine.exportChanges();
    await syncNow();
    const db = await getDb();
    expect(await db.all(sql`SELECT title FROM saves WHERE id = 'remote-1'`)).toEqual([
      { title: "Kyoto travel notes" },
    ]);
    expect(
      await db.all(sql`SELECT rowid FROM saves_fts WHERE saves_fts MATCH 'kyoto'`),
    ).toHaveLength(1);
    other.close();
  });

  it("refuses a wrong passphrase for an existing library, and an unsafe folder", async () => {
    await enableSync({ folder, passphrase: "a long passphrase" });
    await disableSync();
    await expect(enableSync({ folder, passphrase: "something else" })).rejects.toThrow(
      /doesn't match/,
    );
    await expect(
      enableSync({ folder: "relative/path", passphrase: "a long passphrase" }),
    ).rejects.toThrow();
    await expect(
      enableSync({ folder: config.dataDir, passphrase: "a long passphrase" }),
    ).rejects.toThrow(/outside/);
    await expect(enableSync({ folder, passphrase: "short" })).rejects.toThrow(/8 characters/);
  });

  it("stops recording changes when turned off", async () => {
    await enableSync({ folder, passphrase: "a long passphrase" });
    await disableSync();
    await createSave({ url: "https://example.org/x", title: "Not synced" });
    const db = await getDb();
    expect(await db.all(sql`SELECT * FROM sync_outbox`)).toEqual([]);
    expect(await getSetting("sync")).toBeNull();
  });

  it("leaves sync identity and key out of backups", async () => {
    await enableSync({ folder, passphrase: "a long passphrase" });
    await createSave({ url: "https://example.org/y", title: "In backup" });
    const { stream } = await createBackup();
    const chunks: Buffer[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    const tar = Buffer.concat(chunks);
    const stored = (await getSetting<{ key: string; deviceId: string }>("sync"))!;
    expect(tar.includes(stored.key)).toBe(false);
    expect(tar.includes(stored.deviceId)).toBe(false);
    expect(tar.includes("tymo_sync_saves_i")).toBe(false);
  });
});
