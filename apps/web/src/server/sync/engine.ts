/**
 * The sync engine: exports this device's changes to the sync folder and applies the other
 * devices' changes, so every device converges on the same library.
 *
 * - A record is one row's change: { t: table, k: key, v: version, f: fields, full, d }.
 * - Conflicts are resolved per field: each field keeps the value with the newest version
 *   (hybrid logical clock), so a title edited on one Mac and tags on another both survive.
 * - Deletions are tombstones; an older edit can't bring a row back.
 * - Two rows that mean the same thing (same tag name, same link, same folder) created on
 *   different devices are merged into one; every device picks the same survivor.
 * - Records whose parent row hasn't arrived yet (cloud drives deliver files in any order)
 *   wait in sync_pending and are retried.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { DB, Executor } from "../db";
import { newId } from "../ids";
import { reindexSave, removeFromIndex } from "../search";
import { forgetEmbeddings } from "../embeddings";
import { blobName, open, seal } from "./crypto";
import type { SyncFolder } from "./folder";
import { Hlc, atTime } from "./hlc";
import {
  SPECS,
  SYNC_TABLES,
  isSyncTable,
  pkWhere,
  referencesTo,
  syncedColumns,
  type SyncTable,
} from "./tables";

export interface SyncRecord {
  t: SyncTable;
  k: string;
  v: string;
  /** Field values (raw column values). Absent for deletions. */
  f?: Record<string, unknown>;
  /** The record carries every synced column (a new row). */
  full?: 1;
  d?: 1;
}

interface LogFile {
  app: "tymo";
  format: 1;
  device: string;
  records: SyncRecord[];
}

export interface EngineOptions {
  db: DB;
  folder: SyncFolder;
  key: Buffer;
  deviceId: string;
  /** Where this device keeps uploaded files (files.storage_key names them). */
  filesDir: string;
  clock?: () => number;
}

type Outcome = "applied" | "skipped" | "pending";

const RECORDS_PER_FILE = 1000;
const PENDING_TTL = 30 * 86_400_000;
const GAP_PATIENCE = 60 * 60_000;

export class SyncEngine {
  private hlc: Hlc;
  private ready: Promise<void>;
  /** When a gap in another device's log was first seen (its files can arrive out of order). */
  private gaps = new Map<string, number>();

  constructor(private readonly o: EngineOptions) {
    const hlc = new Hlc(o.deviceId, o.clock);
    this.hlc = hlc;
    this.ready = (async () => {
      const [row] = await o.db.all<{ ver: string | null }>(
        sql`SELECT max(ver) AS ver FROM sync_versions`,
      );
      if (row?.ver) hlc.observe(row.ver);
    })();
  }

  /* -------------------------------------------------------------- export */

  /** Writes queued local changes to this device's log. Returns how many records it wrote. */
  async exportChanges(): Promise<number> {
    await this.ready;
    const { db } = this.o;
    let written = 0;
    for (;;) {
      const rows = await db.all<{
        id: number;
        tbl: string;
        pk: string;
        op: string;
        cols: string | null;
      }>(
        sql`SELECT id, tbl, pk, op, cols FROM sync_outbox ORDER BY id LIMIT ${RECORDS_PER_FILE * 3}`,
      );
      if (!rows.length) return written;
      const maxId = rows[rows.length - 1]!.id;

      const groups = new Map<
        string,
        { t: SyncTable; k: string; full: boolean; snapshot: boolean; cols: Set<string> }
      >();
      for (const r of rows) {
        if (!isSyncTable(r.tbl)) continue;
        const id = `${r.tbl}\u0000${r.pk}`;
        const g = groups.get(id) ?? {
          t: r.tbl,
          k: r.pk,
          full: false,
          snapshot: true,
          cols: new Set<string>(),
        };
        if (r.op !== "s") g.snapshot = false;
        if (r.op === "i" || r.op === "s") g.full = true;
        if (r.op === "u" && r.cols) {
          for (const c of JSON.parse(r.cols) as (string | null)[]) if (c) g.cols.add(c);
        }
        groups.set(id, g);
      }

      const records: SyncRecord[] = [];
      for (const g of groups.values()) {
        const [row] = await db.all<Record<string, unknown>>(
          sql`SELECT * FROM ${sql.identifier(g.t)} WHERE ${pkWhere(SPECS[g.t], g.k)}`,
        );
        // A device's first sync dates rows by their last edit, so joining an existing
        // library with an older copy never overrides newer edits made elsewhere.
        const v = g.snapshot && row ? atTime(rowTime(row), this.o.deviceId) : this.hlc.now();
        if (!row) {
          records.push({ t: g.t, k: g.k, v, d: 1 });
          continue;
        }
        const synced = await syncedColumns(db, g.t);
        const cols = g.full ? synced : synced.filter((c) => g.cols.has(c));
        if (!cols.length) continue;
        const f: Record<string, unknown> = {};
        for (const c of cols) f[c] = row[c] ?? null;
        records.push({ t: g.t, k: g.k, v, f, ...(g.full ? { full: 1 as const } : {}) });
        if (g.t === "files" && g.full) await this.uploadBlob(row);
      }

      for (let i = 0; i < records.length; i += RECORDS_PER_FILE) {
        const chunk = records.slice(i, i + RECORDS_PER_FILE);
        const seq = ((await this.o.folder.logs(this.o.deviceId)).at(-1) ?? 0) + 1;
        const file: LogFile = { app: "tymo", format: 1, device: this.o.deviceId, records: chunk };
        await this.o.folder.writeLog(
          this.o.deviceId,
          seq,
          seal(Buffer.from(JSON.stringify(file)), this.o.key, "log"),
        );
      }

      await db.transaction(
        async (tx) => {
          for (const r of records) {
            if (r.d) await setVersion(tx, r.t, r.k, "*", r.v);
            else for (const c of Object.keys(r.f ?? {})) await setVersion(tx, r.t, r.k, c, r.v);
          }
          await tx.run(sql`DELETE FROM sync_outbox WHERE id <= ${maxId}`);
        },
        { behavior: "immediate" },
      );
      written += records.length;
    }
  }

  private async uploadBlob(row: Record<string, unknown>) {
    const sha = String(row.sha256 ?? "");
    const key = String(row.storage_key ?? "");
    if (!/^[a-f0-9]{64}$/.test(sha) || !/^[0-9a-f-]{36}$/.test(key)) return;
    const name = blobName(sha, this.o.key);
    if (await this.o.folder.hasBlob(name)) return;
    const data = await fs.readFile(path.join(this.o.filesDir, key)).catch(() => null);
    if (data) await this.o.folder.writeBlob(name, seal(data, this.o.key, "blob"));
  }

  /* -------------------------------------------------------------- import */

  /** Applies new changes from other devices. Returns how many records changed this library. */
  async importChanges(): Promise<{ applied: number; pending: number }> {
    await this.ready;
    const { db, folder } = this.o;
    const cursors = new Map(
      (
        await db.all<{ device: string; seq: number }>(sql`SELECT device, seq FROM sync_cursors`)
      ).map((c) => [c.device, c.seq]),
    );
    const incoming: SyncRecord[] = [];
    const advanced = new Map<string, number>();
    for (const device of await folder.devices()) {
      if (device === this.o.deviceId) continue;
      let at = cursors.get(device) ?? 0;
      for (const seq of await folder.logs(device)) {
        if (seq <= at) continue;
        if (seq !== at + 1 && !this.gapExpired(device, at + 1)) break;
        let file: LogFile;
        try {
          file = JSON.parse(open(await folder.readLog(device, seq), this.o.key, "log").toString());
        } catch {
          break; // still syncing, or damaged: try again next time
        }
        if (file.app === "tymo" && Array.isArray(file.records)) {
          for (const r of file.records) if (validRecord(r)) incoming.push(r);
        }
        at = seq;
      }
      if (at !== (cursors.get(device) ?? 0)) advanced.set(device, at);
    }

    const [{ n: pendingBefore } = { n: 0 }] = await db.all<{ n: number }>(
      sql`SELECT count(*) AS n FROM sync_pending`,
    );
    if (!incoming.length && !pendingBefore) return { applied: 0, pending: 0 };
    for (const r of incoming) this.hlc.observe(r.v);

    const effects = new Effects();
    let applied = 0;
    await db.transaction(
      async (tx) => {
        await tx.run(sql`UPDATE sync_state SET muted = 1 WHERE id = 1`);
        try {
          for (const r of order(incoming)) {
            const out = await this.apply(tx, r, effects);
            if (out === "applied") applied++;
            if (out === "pending")
              await tx.run(sql`INSERT INTO sync_pending (rec) VALUES (${JSON.stringify(r)})`);
          }
          applied += await this.retryPending(tx, effects);
          for (const [device, seq] of advanced)
            await tx.run(sql`INSERT INTO sync_cursors (device, seq) VALUES (${device}, ${seq})
              ON CONFLICT(device) DO UPDATE SET seq = excluded.seq`);
        } finally {
          await tx.run(sql`UPDATE sync_state SET muted = 0 WHERE id = 1`);
        }
      },
      { behavior: "immediate" },
    );
    await effects.finish(db, this.o.filesDir);
    const [{ n } = { n: 0 }] = await db.all<{ n: number }>(
      sql`SELECT count(*) AS n FROM sync_pending`,
    );
    return { applied, pending: n };
  }

  private gapExpired(device: string, seq: number): boolean {
    const id = `${device}:${seq}`;
    const since = this.gaps.get(id);
    if (since === undefined) {
      this.gaps.set(id, Date.now());
      return false;
    }
    return Date.now() - since > GAP_PATIENCE;
  }

  private async retryPending(tx: Executor, effects: Effects): Promise<number> {
    let applied = 0;
    for (let round = 0; round < 10; round++) {
      const rows = await tx.all<{ id: number; rec: string; first_seen: number }>(
        sql`SELECT id, rec, first_seen FROM sync_pending ORDER BY id`,
      );
      let progress = false;
      for (const row of rows) {
        const rec = JSON.parse(row.rec) as SyncRecord;
        const out = await this.apply(tx, rec, effects);
        if (out !== "pending" || Date.now() - row.first_seen > PENDING_TTL) {
          await tx.run(sql`DELETE FROM sync_pending WHERE id = ${row.id}`);
          if (out === "applied") {
            applied++;
            progress = true;
          }
        }
      }
      if (!progress) break;
    }
    return applied;
  }

  /** Applies one record. Assumes triggers are muted. */
  private async apply(tx: Executor, input: SyncRecord, effects: Effects): Promise<Outcome> {
    const spec = SPECS[input.t];
    const rec = await resolveAliases(tx, input);
    const versions = await versionsOf(tx, rec.t, rec.k);
    const tomb = versions.get("*");
    if (tomb && tomb >= rec.v) return "skipped";

    const [row] = await tx.all<Record<string, unknown>>(
      sql`SELECT * FROM ${sql.identifier(rec.t)} WHERE ${pkWhere(spec, rec.k)}`,
    );

    if (rec.d) {
      const newestLocal = [...versions.entries()]
        .filter(([c]) => c !== "*")
        .reduce((m, [, v]) => (v > m ? v : m), "");
      if (newestLocal > rec.v) return "skipped"; // edited here after it was deleted there
      if (row) await deleteRow(tx, rec.t, rec.k, row, effects);
      await setVersion(tx, rec.t, rec.k, "*", rec.v);
      return row ? "applied" : "skipped";
    }

    const fields = rec.f ?? {};
    if (row) {
      const newer = Object.keys(fields).filter(
        (c) => !spec.pk.includes(c) && (!versions.has(c) || rec.v > versions.get(c)!),
      );
      if (!newer.length) return "skipped";
      if (!(await parentsPresent(tx, rec.t, fields, newer))) return "pending";
      await tx.run(
        sql`UPDATE ${sql.identifier(rec.t)} SET ${sql.join(
          newer.map((c) => sql`${sql.identifier(c)} = ${fields[c] as never}`),
          sql`, `,
        )} WHERE ${pkWhere(spec, rec.k)}`,
      );
      for (const c of newer) await setVersion(tx, rec.t, rec.k, c, rec.v);
      effects.touch(rec.t, rec.k, fields);
      return "applied";
    }

    if (!rec.full) return "pending";
    const twin = await findTwin(tx, rec.t, rec.k, fields);
    if (twin) return this.merge(tx, rec, twin, effects);
    if (!(await parentsPresent(tx, rec.t, fields, Object.keys(fields)))) return "pending";
    return (await this.insert(tx, rec, fields, effects)) ? "applied" : "pending";
  }

  /** Inserts a new row from another device, filling in this device's local columns. */
  private async insert(
    tx: Executor,
    rec: SyncRecord,
    fields: Record<string, unknown>,
    effects: Effects,
  ): Promise<boolean> {
    const values: Record<string, unknown> = { ...fields };
    if (rec.t === "saves") {
      const [{ next } = { next: 1 }] = await tx.all<{ next: number }>(
        sql`SELECT coalesce(max(seq), 0) + 1 AS next FROM saves`,
      );
      values.seq = next;
    }
    if (rec.t === "files") {
      const key = await this.downloadBlob(String(fields.sha256 ?? ""), effects);
      if (!key) return false;
      values.storage_key = key;
    }
    const cols = Object.keys(values);
    await tx.run(
      sql`INSERT INTO ${sql.identifier(rec.t)} (${sql.join(
        cols.map((c) => sql.identifier(c)),
        sql`, `,
      )}) VALUES (${sql.join(
        cols.map((c) => sql`${values[c] as never}`),
        sql`, `,
      )})`,
    );
    for (const c of Object.keys(fields)) await setVersion(tx, rec.t, rec.k, c, rec.v);
    effects.touch(rec.t, rec.k, fields);
    return true;
  }

  private async downloadBlob(sha: string, effects: Effects): Promise<string | null> {
    if (!/^[a-f0-9]{64}$/.test(sha)) return null;
    const sealed = await this.o.folder.readBlob(blobName(sha, this.o.key));
    if (!sealed) return null;
    let data: Buffer;
    try {
      data = open(sealed, this.o.key, "blob");
    } catch {
      return null;
    }
    if (createHash("sha256").update(data).digest("hex") !== sha) return null;
    const key = newId();
    await fs.mkdir(this.o.filesDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(this.o.filesDir, key), data, { mode: 0o600, flag: "wx" });
    effects.newFiles.push(key);
    return key;
  }

  /**
   * Two devices created the same thing (tag name, link, folder) under different ids.
   * Keep the one with the smaller id everywhere, so all devices agree without talking.
   */
  private async merge(
    tx: Executor,
    rec: SyncRecord,
    localId: string,
    effects: Effects,
  ): Promise<Outcome> {
    const t = rec.t;
    if (localId < rec.k) {
      await addAlias(tx, t, rec.k, localId);
      return this.apply(tx, { ...rec, k: localId }, effects);
    }
    // The incoming row survives: build it from the newest value of each field.
    const [local] = await tx.all<Record<string, unknown>>(
      sql`SELECT * FROM ${sql.identifier(t)} WHERE id = ${localId}`,
    );
    if (!local) return "pending";
    const localVersions = await versionsOf(tx, t, localId);
    const fields: Record<string, unknown> = { ...rec.f };
    const keepLocal: string[] = [];
    for (const c of Object.keys(fields)) {
      if (SPECS[t].pk.includes(c)) continue;
      const lv = localVersions.get(c);
      if (lv && lv > rec.v) {
        fields[c] = local[c] ?? null;
        keepLocal.push(c);
      }
    }
    if (!(await parentsPresent(tx, t, fields, Object.keys(fields)))) return "pending";
    // Free unique values (a tag's name) before the survivor takes them.
    if (t === "tags")
      await tx.run(sql`UPDATE tags SET name = ${`\u0000merging:${localId}`} WHERE id = ${localId}`);
    if (!(await this.insert(tx, { ...rec, f: fields }, fields, effects))) {
      if (t === "tags")
        await tx.run(sql`UPDATE tags SET name = ${local.name as string} WHERE id = ${localId}`);
      return "pending";
    }
    for (const c of keepLocal) await setVersion(tx, t, rec.k, c, localVersions.get(c)!);
    for (const ref of referencesTo(t)) {
      await tx.run(
        sql`UPDATE OR IGNORE ${sql.identifier(ref.table)} SET ${sql.identifier(ref.col)} = ${rec.k}
            WHERE ${sql.identifier(ref.col)} = ${localId}`,
      );
      await tx.run(
        sql`DELETE FROM ${sql.identifier(ref.table)} WHERE ${sql.identifier(ref.col)} = ${localId}`,
      );
    }
    if (t === "saves") {
      await removeFromIndex(tx, [Number(local.seq)]);
      await tx.run(sql`DELETE FROM embeddings WHERE save_id = ${localId}`);
      effects.deletedSaves.push(localId);
    }
    await tx.run(sql`DELETE FROM ${sql.identifier(t)} WHERE id = ${localId}`);
    await tx.run(sql`DELETE FROM sync_versions WHERE tbl = ${t} AND pk = ${localId}`);
    await addAlias(tx, t, localId, rec.k);
    effects.touch(t, rec.k, fields);
    return "applied";
  }
}

/* ---------------------------------------------------------------- helpers */

function rowTime(row: Record<string, unknown>): number {
  for (const c of ["updated_at", "created_at", "added_at"]) {
    const v = Number(row[c]);
    if (Number.isFinite(v) && v > 0) return Math.min(v, Date.now());
  }
  return 0;
}

function validRecord(r: unknown): r is SyncRecord {
  if (!r || typeof r !== "object") return false;
  const x = r as Partial<SyncRecord>;
  return (
    typeof x.t === "string" &&
    isSyncTable(x.t) &&
    typeof x.k === "string" &&
    x.k.length > 0 &&
    x.k.length < 200 &&
    typeof x.v === "string" &&
    (x.d === 1 || (typeof x.f === "object" && x.f !== null))
  );
}

/** Parents before children for new rows; children before parents for deletions. */
function order(records: SyncRecord[]): SyncRecord[] {
  const rank = (r: SyncRecord) => {
    const i = SYNC_TABLES.indexOf(r.t);
    return r.d ? 100 + (SYNC_TABLES.length - i) : i;
  };
  return [...records].sort((a, b) => rank(a) - rank(b) || (a.v < b.v ? -1 : a.v > b.v ? 1 : 0));
}

async function versionsOf(tx: Executor, t: string, k: string): Promise<Map<string, string>> {
  const rows = await tx.all<{ col: string; ver: string }>(
    sql`SELECT col, ver FROM sync_versions WHERE tbl = ${t} AND pk = ${k}`,
  );
  return new Map(rows.map((r) => [r.col, r.ver]));
}

async function setVersion(tx: Executor, t: string, k: string, col: string, ver: string) {
  await tx.run(sql`INSERT INTO sync_versions (tbl, pk, col, ver) VALUES (${t}, ${k}, ${col}, ${ver})
    ON CONFLICT(tbl, pk, col) DO UPDATE SET ver = excluded.ver WHERE excluded.ver > sync_versions.ver`);
}

async function aliasOf(tx: Executor, t: string, id: string): Promise<string> {
  let current = id;
  for (let i = 0; i < 5; i++) {
    const [row] = await tx.all<{ to_id: string }>(
      sql`SELECT to_id FROM sync_aliases WHERE tbl = ${t} AND from_id = ${current}`,
    );
    if (!row) return current;
    current = row.to_id;
  }
  return current;
}

async function addAlias(tx: Executor, t: string, from: string, to: string) {
  await tx.run(sql`INSERT INTO sync_aliases (tbl, from_id, to_id) VALUES (${t}, ${from}, ${to})
    ON CONFLICT(tbl, from_id) DO UPDATE SET to_id = excluded.to_id`);
  await tx.run(sql`UPDATE sync_aliases SET to_id = ${to} WHERE tbl = ${t} AND to_id = ${from}`);
}

/** Rewrites ids of rows that were merged on this device into the ids that survived. */
async function resolveAliases(tx: Executor, rec: SyncRecord): Promise<SyncRecord> {
  const spec = SPECS[rec.t];
  const parts = rec.k.split("|");
  const mapped = await Promise.all(
    spec.pk.map(async (col, i) => {
      const fk = spec.fks.find((f) => f.col === col);
      const table = fk ? fk.table : col === "id" ? rec.t : null;
      return table ? aliasOf(tx, table, parts[i] ?? "") : (parts[i] ?? "");
    }),
  );
  const f = rec.f ? { ...rec.f } : undefined;
  if (f) {
    for (const fk of spec.fks) {
      if (typeof f[fk.col] === "string")
        f[fk.col] = await aliasOf(tx, fk.table, f[fk.col] as string);
    }
    spec.pk.forEach((col, i) => {
      if (col in f) f[col] = mapped[i];
    });
  }
  return { ...rec, k: mapped.join("|"), ...(f ? { f } : {}) };
}

async function exists(tx: Executor, table: SyncTable, id: string): Promise<boolean> {
  const rows = await tx.all(sql`SELECT 1 FROM ${sql.identifier(table)} WHERE id = ${id} LIMIT 1`);
  return rows.length > 0;
}

/** Every non-null link in the fields being written points at a row that exists here. */
async function parentsPresent(
  tx: Executor,
  t: SyncTable,
  fields: Record<string, unknown>,
  cols: string[],
): Promise<boolean> {
  for (const fk of SPECS[t].fks) {
    if (!cols.includes(fk.col)) continue;
    const v = fields[fk.col];
    if (v === null || v === undefined) continue;
    if (!(await exists(tx, fk.table, String(v)))) return false;
  }
  return true;
}

/** A row on this device that means the same as the incoming one. */
async function findTwin(
  tx: Executor,
  t: SyncTable,
  k: string,
  f: Record<string, unknown>,
): Promise<string | null> {
  let rows: { id: string }[] = [];
  if (t === "tags" && typeof f.name === "string") {
    rows = await tx.all(sql`SELECT id FROM tags WHERE name = ${f.name} AND id != ${k}`);
  } else if (t === "collections" && typeof f.name === "string") {
    const parent = (f.parent_id as string | null) ?? null;
    rows = await tx.all(sql`SELECT id FROM collections
      WHERE lower(name) = lower(${f.name}) AND parent_id IS ${parent} AND id != ${k}
      ORDER BY id LIMIT 1`);
  } else if (t === "saves" && typeof f.normalized_url === "string" && f.type !== "quote") {
    rows = await tx.all(sql`SELECT id FROM saves
      WHERE normalized_url = ${f.normalized_url} AND type != 'quote' AND id != ${k}
      ORDER BY id LIMIT 1`);
  }
  return rows[0]?.id ?? null;
}

async function deleteRow(
  tx: Executor,
  t: SyncTable,
  k: string,
  row: Record<string, unknown>,
  effects: Effects,
) {
  if (t === "saves") {
    const files = await tx.all<{ storage_key: string }>(
      sql`SELECT storage_key FROM files WHERE save_id = ${k}`,
    );
    effects.oldFiles.push(...files.map((f) => f.storage_key));
    await removeFromIndex(tx, [Number(row.seq)]);
    effects.deletedSaves.push(k);
  }
  if (t === "files") effects.oldFiles.push(String(row.storage_key));
  if (t === "tags" || t === "collections") {
    const link = t === "tags" ? "save_tags" : "save_collections";
    const col = t === "tags" ? "tag_id" : "collection_id";
    const members = await tx.all<{ save_id: string }>(
      sql`SELECT save_id FROM ${sql.identifier(link)} WHERE ${sql.identifier(col)} = ${k}`,
    );
    for (const m of members) effects.saves.add(m.save_id);
  }
  if (t === "collections")
    await tx.run(sql`UPDATE collections SET parent_id = NULL WHERE parent_id = ${k}`);
  await tx.run(sql`DELETE FROM ${sql.identifier(t)} WHERE ${pkWhere(SPECS[t], k)}`);
  if (t === "save_tags" || t === "save_collections") effects.saves.add(k.split("|")[0]!);
}

/** What has to happen after a batch is committed: search index, files on disk. */
class Effects {
  saves = new Set<string>();
  tags = new Set<string>();
  collections = new Set<string>();
  deletedSaves: string[] = [];
  oldFiles: string[] = [];
  newFiles: string[] = [];

  touch(t: SyncTable, k: string, f: Record<string, unknown>) {
    if (t === "saves") this.saves.add(k);
    else if (t === "save_tags" || t === "save_collections") this.saves.add(k.split("|")[0]!);
    else if (t === "tags") this.tags.add(k);
    else if (t === "collections") this.collections.add(k);
    else if (t === "files" && typeof f.save_id === "string") this.saves.add(f.save_id);
  }

  async finish(db: DB, filesDir: string) {
    for (const id of this.tags) {
      const rows = await db.all<{ save_id: string }>(
        sql`SELECT save_id FROM save_tags WHERE tag_id = ${id}`,
      );
      for (const r of rows) this.saves.add(r.save_id);
    }
    for (const id of this.collections) {
      const rows = await db.all<{ save_id: string }>(
        sql`SELECT save_id FROM save_collections WHERE collection_id = ${id}`,
      );
      for (const r of rows) this.saves.add(r.save_id);
    }
    for (const id of this.saves) await reindexSave(db, id);
    if (this.deletedSaves.length) forgetEmbeddings(this.deletedSaves);
    for (const key of this.oldFiles) {
      if (/^[0-9a-f-]{36}$/.test(key)) await fs.rm(path.join(filesDir, key), { force: true });
    }
  }
}
