/**
 * What sync covers. Everything else (settings, API tokens, connected apps, embeddings,
 * caches) stays on each device.
 */
import { sql } from "drizzle-orm";
import type { Executor } from "../db";

export interface ForeignKey {
  col: string;
  table: SyncTable;
  /** The row can't exist without its parent (otherwise the link is just cleared). */
  required: boolean;
}

export interface TableSpec {
  name: SyncTable;
  pk: string[];
  /** Columns that only make sense on this device; never sent, set locally on insert. */
  local: string[];
  fks: ForeignKey[];
}

export const SYNC_TABLES = [
  "tags",
  "collections",
  "saves",
  "sessions",
  "files",
  "save_tags",
  "save_collections",
  "session_items",
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export const SPECS: Record<SyncTable, TableSpec> = {
  tags: { name: "tags", pk: ["id"], local: [], fks: [] },
  collections: {
    name: "collections",
    pk: ["id"],
    local: [],
    fks: [{ col: "parent_id", table: "collections", required: false }],
  },
  // seq is the full-text index's row id on this device.
  saves: { name: "saves", pk: ["id"], local: ["seq"], fks: [] },
  sessions: { name: "sessions", pk: ["id"], local: [], fks: [] },
  // storage_key names this device's copy of the file; the content travels as a blob.
  files: {
    name: "files",
    pk: ["id"],
    local: ["storage_key"],
    fks: [{ col: "save_id", table: "saves", required: false }],
  },
  save_tags: {
    name: "save_tags",
    pk: ["save_id", "tag_id"],
    local: [],
    fks: [
      { col: "save_id", table: "saves", required: true },
      { col: "tag_id", table: "tags", required: true },
    ],
  },
  save_collections: {
    name: "save_collections",
    pk: ["save_id", "collection_id"],
    local: [],
    fks: [
      { col: "save_id", table: "saves", required: true },
      { col: "collection_id", table: "collections", required: true },
    ],
  },
  session_items: {
    name: "session_items",
    pk: ["id"],
    local: [],
    fks: [
      { col: "session_id", table: "sessions", required: true },
      { col: "save_id", table: "saves", required: false },
    ],
  },
};

/** Columns that point at rows of `table`, for repointing when two rows are merged. */
export function referencesTo(table: SyncTable): { table: SyncTable; col: string }[] {
  return SYNC_TABLES.flatMap((t) =>
    SPECS[t].fks.filter((f) => f.table === table).map((f) => ({ table: t, col: f.col })),
  );
}

export function isSyncTable(name: string): name is SyncTable {
  return (SYNC_TABLES as readonly string[]).includes(name);
}

/** Composite keys are joined with "|"; ids never contain it. */
export function pkOf(spec: TableSpec, row: Record<string, unknown>): string {
  return spec.pk.map((c) => String(row[c])).join("|");
}

export function pkWhere(spec: TableSpec, pk: string) {
  const parts = pk.split("|");
  return sql.join(
    spec.pk.map((c, i) => sql`${sql.identifier(c)} = ${parts[i] ?? ""}`),
    sql` AND `,
  );
}

const columnCache = new Map<string, string[]>();

export async function columnsOf(db: Executor, table: SyncTable): Promise<string[]> {
  const cached = columnCache.get(table);
  if (cached) return cached;
  const rows = await db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info(${table})`);
  const cols = rows.map((r) => r.name);
  columnCache.set(table, cols);
  return cols;
}

export async function syncedColumns(db: Executor, table: SyncTable): Promise<string[]> {
  const local = new Set(SPECS[table].local);
  return (await columnsOf(db, table)).filter((c) => !local.has(c));
}
