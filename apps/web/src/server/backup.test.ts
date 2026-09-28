import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { tarHeader, tarPadding, TAR_END } from "@tymo/core/tar";
import { resetDbForTests } from "./db";
import { createSave, deleteSaves, getSave, listSaves } from "./saves";
import { readStoredFile, storeFile } from "./files";
import { getAiSettings, saveAiSettings } from "./settings";
import {
  createBackup,
  listBackups,
  maybeScheduledBackup,
  restoreBackup,
  saveBackupSettings,
  storedBackupPath,
  writeBackupFile,
} from "./backup";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function collect(stream: ReadableStream<Uint8Array>) {
  return Buffer.from(await new Response(stream).arrayBuffer());
}
const streamOf = (buf: Uint8Array) => new Response(new Uint8Array(buf)).body!;

function tarOf(entries: [string, Uint8Array][]) {
  const parts: Uint8Array[] = [];
  for (const [name, data] of entries) {
    parts.push(tarHeader(name, data.byteLength), data, new Uint8Array(tarPadding(data.byteLength)));
  }
  parts.push(TAR_END);
  return gzipSync(Buffer.concat(parts));
}

let dir = "";
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-bak-"));
  await resetDbForTests(`file:${path.join(dir, "tymo.db")}`);
});

describe("backup & restore", () => {
  it("round-trips the database and files", async () => {
    const note = await createSave({
      title: "Keep me",
      type: "note",
      body: "precious",
      tags: ["x"],
    });
    const shot = await createSave({ title: "Shot", type: "screenshot" });
    const file = await storeFile(PNG, { saveId: shot.id, kind: "screenshot" });

    const { stream, name } = await createBackup();
    expect(name).toMatch(/^tymo-backup-\d{4}-\d{2}-\d{2}\.tar\.gz$/);
    const archive = await collect(stream);
    const listing = execFileSync("tar", ["-tzf", "-"], { input: archive }).toString().split("\n");
    expect(listing).toEqual(expect.arrayContaining(["manifest.json", "tymo.db"]));
    expect(listing.filter((l) => l.startsWith("files/"))).toHaveLength(1);
    // The temporary snapshot is cleaned up.
    expect(fs.readdirSync(process.env.TYMO_DATA_DIR!).some((f) => f.startsWith(".backup-"))).toBe(
      false,
    );

    await deleteSaves([note.id, shot.id]);
    await createSave({ title: "Made after the backup", type: "note" });
    expect(await getSave(note.id)).toBeNull();

    const r = await restoreBackup(streamOf(archive));
    expect(r).toMatchObject({ saves: 2, files: 1 });
    expect((await getSave(note.id))!.tags).toEqual(["x"]);
    expect((await listSaves({ q: "precious" })).items.map((i) => i.id)).toEqual([note.id]);
    expect((await listSaves({ q: "after the backup" })).items).toHaveLength(0);
    expect(Buffer.from((await readStoredFile(file.id))!.data)).toEqual(Buffer.from(PNG));
    // The replaced data was moved aside, not deleted.
    expect(fs.existsSync(path.join(r.previousDataAt, "tymo.db"))).toBe(true);
  });

  it("writes scheduled backups to TYMO_BACKUP_DIR (e.g. a synced folder)", async () => {
    const off = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-offsite-"));
    process.env.TYMO_BACKUP_DIR = off;
    try {
      await createSave({ title: "Keep me safe", type: "note" });
      await writeBackupFile();
      expect(fs.readdirSync(off).filter((f) => f.endsWith(".tar.gz"))).toHaveLength(1);
      expect((await listBackups()).length).toBe(1);
    } finally {
      delete process.env.TYMO_BACKUP_DIR;
    }
  });

  it("never includes the AI provider's API key", async () => {
    await saveAiSettings({ provider: "anthropic", apiKey: "sk-ant-very-secret-key-123" });
    await createSave({ title: "Anything", type: "note" });
    const tar = gunzipSync(await collect((await createBackup()).stream));
    expect(tar.includes("sk-ant-very-secret-key-123")).toBe(false);
    expect(tar.includes("anthropic")).toBe(true); // the rest of the settings are kept
    expect((await getAiSettings()).apiKey).toBe("sk-ant-very-secret-key-123"); // live copy untouched
  });

  it("rejects archives that aren't well-formed Tymo backups", async () => {
    await createSave({ title: "Still here", type: "note" });
    const manifest = new TextEncoder().encode(JSON.stringify({ app: "tymo", format: 1 }));
    const cases: [Uint8Array, RegExp][] = [
      [new TextEncoder().encode("not gzip at all"), /./],
      [
        tarOf([
          ["manifest.json", manifest],
          ["evil.sh", new Uint8Array(3)],
        ]),
        /Unexpected file/,
      ],
      [tarOf([["manifest.json", manifest]]), /no database/],
      [
        tarOf([["manifest.json", new TextEncoder().encode('{"app":"other"}')]]),
        /not a Tymo backup/,
      ],
      [
        tarOf([
          ["manifest.json", manifest],
          ["tymo.db", new TextEncoder().encode("garbage")],
        ]),
        /can't be opened|damaged/,
      ],
    ];
    // A header whose name escapes the folder (bypassing tarHeader's own check).
    const raw = tarHeader("files/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", 1);
    raw.set(new TextEncoder().encode("../../evil".padEnd(40, "\0")), 0);
    let sum = 0;
    raw.fill(0x20, 148, 156);
    for (const b of raw) sum += b;
    raw.set(new TextEncoder().encode(sum.toString(8).padStart(6, "0") + "\0"), 148);
    cases.push([gzipSync(Buffer.concat([raw, new Uint8Array(512), TAR_END])), /Unsafe path/]);

    for (const [bytes, err] of cases) {
      await expect(restoreBackup(streamOf(bytes))).rejects.toThrow(err);
    }
    expect((await listSaves({ q: "still" })).items).toHaveLength(1);
    expect(fs.readdirSync(process.env.TYMO_DATA_DIR!).some((f) => f.startsWith(".restore-"))).toBe(
      false,
    );
  });

  it("writes scheduled backups once a day and keeps the newest N", async () => {
    await createSave({ title: "Scheduled", type: "note" });
    expect(await maybeScheduledBackup()).toBeNull(); // off by default
    await saveBackupSettings({ auto: true, keep: 2 });
    const first = await maybeScheduledBackup();
    expect(first).toMatch(/^tymo-backup-.*\.tar\.gz$/);
    expect(await maybeScheduledBackup()).toBeNull(); // not due yet
    await writeBackupFile();
    await writeBackupFile();
    const list = await listBackups();
    expect(list).toHaveLength(2);
    expect(list.map((b) => b.name)).not.toContain(first);
    expect(storedBackupPath("../tymo.db")).toBeNull();
    expect(storedBackupPath(list[0]!.name)).toContain("backups");
  });
});
