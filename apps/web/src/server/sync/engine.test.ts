import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createClient, type Client } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { config } from "../config";
import { schema, type DB } from "../db";
import { deriveKey, newSalt } from "./crypto";
import { SyncEngine } from "./engine";
import { SyncFolder } from "./folder";
import { installTriggers, queueEverything } from "./triggers";

let key: Buffer;
let shared: string;
const open: Client[] = [];

beforeAll(async () => {
  key = await deriveKey("correct horse battery staple", newSalt());
});

afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

interface Device {
  db: DB;
  engine: SyncEngine;
  filesDir: string;
  sync: () => Promise<void>;
}

async function device(id: string, folderRoot = shared, k = key): Promise<Device> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tymo-sync-${id.slice(0, 4)}-`));
  const client = createClient({ url: `file:${path.join(dir, "t.db")}` });
  open.push(client);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: config.migrationsDir });
  await installTriggers(db);
  const filesDir = path.join(dir, "files");
  const engine = new SyncEngine({
    db,
    folder: new SyncFolder(folderRoot),
    key: k,
    deviceId: id,
    filesDir,
  });
  return {
    db,
    engine,
    filesDir,
    sync: async () => {
      await engine.exportChanges();
      await engine.importChanges();
    },
  };
}

function freshFolder() {
  shared = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-sync-folder-"));
  return shared;
}

let seq = 0;
async function addSave(d: Device, id: string, url: string, title: string, at = Date.now()) {
  const n = ++seq;
  await d.db.run(sql`INSERT INTO saves (id, seq, title, url, normalized_url, created_at, updated_at)
    VALUES (${id}, ${n}, ${title}, ${url}, ${url}, ${at}, ${at})`);
}

async function one<T>(d: Device, q: ReturnType<typeof sql>): Promise<T | undefined> {
  return (await d.db.all<T>(q))[0];
}

const A = "aaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbb";
const C = "cccccccccccccccc";

describe("folder sync between devices", () => {
  it("brings a save, its tag and folder to the other Mac, searchable there", async () => {
    freshFolder();
    const a = await device(A);
    const b = await device(B);
    await addSave(a, "s1", "https://sqlite.org/", "SQLite home");
    await a.db.run(sql`INSERT INTO tags (id, name) VALUES ('t1', 'databases')`);
    await a.db.run(sql`INSERT INTO save_tags (save_id, tag_id) VALUES ('s1', 't1')`);
    await a.db.run(sql`INSERT INTO collections (id, name) VALUES ('c1', 'Dev tools')`);
    await a.db.run(sql`INSERT INTO save_collections (save_id, collection_id) VALUES ('s1', 'c1')`);
    await a.sync();
    await b.sync();

    expect(await one(b, sql`SELECT title FROM saves WHERE id = 's1'`)).toEqual({
      title: "SQLite home",
    });
    expect(await one(b, sql`SELECT tag_id FROM save_tags WHERE save_id = 's1'`)).toEqual({
      tag_id: "t1",
    });
    expect(await one(b, sql`SELECT name FROM collections WHERE id = 'c1'`)).toEqual({
      name: "Dev tools",
    });
    const hit = await b.db.all(sql`SELECT rowid FROM saves_fts WHERE saves_fts MATCH 'databases'`);
    expect(hit).toHaveLength(1);
    // Applying didn't queue the same changes to be sent back.
    expect(await b.db.all(sql`SELECT * FROM sync_outbox`)).toEqual([]);
  });

  it("keeps edits to different fields made on both Macs while apart", async () => {
    freshFolder();
    const a = await device(A);
    const b = await device(B);
    await addSave(a, "s1", "https://a.example/", "Old title");
    await a.sync();
    await b.sync();

    await a.db.run(sql`UPDATE saves SET title = 'New title' WHERE id = 's1'`);
    await b.db.run(sql`UPDATE saves SET is_favorite = 1, notes = 'from B' WHERE id = 's1'`);
    await a.sync();
    await b.sync();
    await a.sync();

    for (const d of [a, b]) {
      expect(
        await one(d, sql`SELECT title, is_favorite, notes FROM saves WHERE id = 's1'`),
      ).toEqual({
        title: "New title",
        is_favorite: 1,
        notes: "from B",
      });
    }
  });

  it("uses the newest edit when both Macs change the same field", async () => {
    freshFolder();
    let now = 1_800_000_000_000;
    const a = await device(A);
    const b = await device(B);
    // Separate clocks, B's edit later.
    (a.engine as unknown as { hlc: { clock: () => number } }).hlc["clock"] = () => now;
    (b.engine as unknown as { hlc: { clock: () => number } }).hlc["clock"] = () => now;
    await addSave(a, "s1", "https://a.example/", "Start");
    await a.sync();
    await b.sync();
    await a.db.run(sql`UPDATE saves SET title = 'From A' WHERE id = 's1'`);
    await a.engine.exportChanges();
    now += 5000;
    await b.db.run(sql`UPDATE saves SET title = 'From B (newer)' WHERE id = 's1'`);
    await b.engine.exportChanges();
    await a.engine.importChanges();
    await b.engine.importChanges();
    for (const d of [a, b])
      expect(await one(d, sql`SELECT title FROM saves WHERE id = 's1'`)).toEqual({
        title: "From B (newer)",
      });
  });

  it("deletes on the other Mac too, and an older edit can't bring it back", async () => {
    freshFolder();
    const a = await device(A);
    const b = await device(B);
    await addSave(a, "s1", "https://a.example/", "Doomed");
    await a.db.run(sql`INSERT INTO tags (id, name) VALUES ('t1', 'x')`);
    await a.db.run(sql`INSERT INTO save_tags (save_id, tag_id) VALUES ('s1', 't1')`);
    await a.sync();
    await b.sync();
    await a.db.run(sql`UPDATE saves SET notes = 'edit before delete' WHERE id = 's1'`);
    await a.engine.exportChanges();
    await b.db.run(sql`DELETE FROM saves WHERE id = 's1'`);
    await b.engine.exportChanges();
    await a.engine.importChanges();
    await b.engine.importChanges();
    for (const d of [a, b]) {
      expect(await d.db.all(sql`SELECT id FROM saves`)).toEqual([]);
      expect(await d.db.all(sql`SELECT * FROM save_tags`)).toEqual([]);
    }
  });

  it("merges the same tag and the same link created on both Macs, keeping one everywhere", async () => {
    freshFolder();
    const a = await device(A);
    const b = await device(B);
    await addSave(a, "a-save", "https://figma.com/", "Figma (A)");
    await a.db.run(sql`INSERT INTO tags (id, name) VALUES ('a-tag', 'design')`);
    await a.db.run(sql`INSERT INTO save_tags (save_id, tag_id) VALUES ('a-save', 'a-tag')`);
    await addSave(b, "b-save", "https://figma.com/", "Figma (B)");
    await b.db.run(sql`UPDATE saves SET notes = 'B notes' WHERE id = 'b-save'`);
    await b.db.run(sql`INSERT INTO tags (id, name) VALUES ('b-tag', 'design')`);
    await b.db.run(sql`INSERT INTO tags (id, name) VALUES ('b-tag2', 'tools')`);
    await b.db.run(
      sql`INSERT INTO save_tags (save_id, tag_id) VALUES ('b-save', 'b-tag'), ('b-save', 'b-tag2')`,
    );
    for (let i = 0; i < 2; i++) {
      await a.sync();
      await b.sync();
    }
    for (const d of [a, b]) {
      expect(await d.db.all(sql`SELECT id FROM saves`)).toEqual([{ id: "a-save" }]);
      expect(await d.db.all(sql`SELECT id, name FROM tags ORDER BY name`)).toEqual([
        { id: "a-tag", name: "design" },
        { id: "b-tag2", name: "tools" },
      ]);
      expect(await d.db.all(sql`SELECT tag_id FROM save_tags ORDER BY tag_id`)).toEqual([
        { tag_id: "a-tag" },
        { tag_id: "b-tag2" },
      ]);
      expect(await one(d, sql`SELECT notes FROM saves`)).toEqual({ notes: "B notes" });
    }
  });

  it("joins an existing library without letting an older copy override newer edits", async () => {
    freshFolder();
    const a = await device(A);
    const b = await device(B);
    const old = Date.now() - 86_400_000;
    // B has an old copy of the same save (e.g. restored from a backup) with a stale title.
    await addSave(a, "s1", "https://a.example/", "Fresh title on A");
    await a.db.run(sql`DELETE FROM sync_outbox`);
    await queueEverything(a.db);
    await a.sync();
    await b.db
      .run(sql`INSERT INTO saves (id, seq, title, url, normalized_url, created_at, updated_at)
      VALUES ('s1', 1, 'Stale title', 'https://a.example/', 'https://a.example/', ${old}, ${old})`);
    await b.db.run(sql`DELETE FROM sync_outbox`);
    await queueEverything(b.db);
    await b.sync();
    await a.sync();
    for (const d of [a, b])
      expect(await one(d, sql`SELECT title FROM saves`)).toEqual({ title: "Fresh title on A" });
  });

  it("copies files encrypted, and the folder never holds readable library data", async () => {
    freshFolder();
    const a = await device(A);
    const b = await device(B);
    await addSave(a, "s1", "https://a.example/", "Secret project plan");
    const data = Buffer.from("PNG-ish bytes of a screenshot ".repeat(50));
    const sha = createHash("sha256").update(data).digest("hex");
    fs.mkdirSync(a.filesDir, { recursive: true });
    const keyA = "11111111-1111-1111-1111-111111111111";
    fs.writeFileSync(path.join(a.filesDir, keyA), data);
    await a.db.run(sql`INSERT INTO files (id, save_id, kind, mime, size, sha256, storage_key)
      VALUES ('f1', 's1', 'screenshot', 'image/png', ${data.length}, ${sha}, ${keyA})`);
    await a.sync();
    await b.sync();

    const row = await one<{ storage_key: string }>(
      b,
      sql`SELECT storage_key FROM files WHERE id = 'f1'`,
    );
    expect(row?.storage_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(fs.readFileSync(path.join(b.filesDir, row!.storage_key)).equals(data)).toBe(true);

    const everything = fs
      .readdirSync(shared, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => fs.readFileSync(path.join(e.parentPath, e.name)));
    for (const buf of everything) {
      expect(buf.includes("Secret project plan")).toBe(false);
      expect(buf.includes("PNG-ish")).toBe(false);
    }
    // And deleting the save removes the copy on the other Mac.
    await a.db.run(sql`DELETE FROM saves WHERE id = 's1'`);
    await a.sync();
    await b.sync();
    expect(fs.existsSync(path.join(b.filesDir, row!.storage_key))).toBe(false);
  });

  it("waits for a parent that hasn't arrived yet, then applies the change", async () => {
    freshFolder();
    const a = await device(A);
    const b = await device(B);
    await addSave(a, "s1", "https://a.example/", "From A");
    await a.sync();
    await b.sync();
    await b.db.run(sql`INSERT INTO tags (id, name) VALUES ('t1', 'later')`);
    await b.db.run(sql`INSERT INTO save_tags (save_id, tag_id) VALUES ('s1', 't1')`);
    await b.sync();

    // C sees B's changes before A's files have reached it.
    const hidden = path.join(shared, "devices", `${A}.hidden`);
    fs.renameSync(path.join(shared, "devices", A), hidden);
    const c = await device(C);
    await c.sync();
    expect(await c.db.all(sql`SELECT * FROM save_tags`)).toEqual([]);
    expect(await c.db.all(sql`SELECT id FROM sync_pending`)).toHaveLength(1);

    fs.renameSync(hidden, path.join(shared, "devices", A));
    await c.sync();
    expect(await c.db.all(sql`SELECT save_id, tag_id FROM save_tags`)).toEqual([
      { save_id: "s1", tag_id: "t1" },
    ]);
    expect(await c.db.all(sql`SELECT id FROM sync_pending`)).toEqual([]);
  });

  it("can't read a library synced with another passphrase", async () => {
    freshFolder();
    const a = await device(A);
    await addSave(a, "s1", "https://a.example/", "Private");
    await a.sync();
    const other = await deriveKey("not the passphrase", newSalt());
    const mallory = await device(B, shared, other);
    expect(await mallory.engine.importChanges()).toEqual({ applied: 0, pending: 0 });
    expect(await mallory.db.all(sql`SELECT id FROM saves`)).toEqual([]);
  });

  it("rebuilds a replaced Mac from the folder alone", async () => {
    freshFolder();
    const a = await device(A);
    for (let i = 0; i < 30; i++) await addSave(a, `s${i}`, `https://e.example/${i}`, `Item ${i}`);
    await a.db.run(sql`INSERT INTO collections (id, name) VALUES ('p', 'Parent')`);
    await a.db.run(sql`INSERT INTO collections (id, name, parent_id) VALUES ('k', 'Child', 'p')`);
    await a.sync();
    // A is lost; a brand-new Mac joins with the passphrase.
    const fresh = await device(C);
    await fresh.sync();
    expect(await one(fresh, sql`SELECT count(*) AS n FROM saves`)).toEqual({ n: 30 });
    expect(await one(fresh, sql`SELECT parent_id FROM collections WHERE id = 'k'`)).toEqual({
      parent_id: "p",
    });
  });
});
