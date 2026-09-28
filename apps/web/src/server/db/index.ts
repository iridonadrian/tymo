import fs from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { config, dbUrl } from "../config";
import * as schema from "./schema";

export type DB = LibSQLDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Executor = DB | Tx;

interface DbState {
  url: string;
  client: Client;
  db: DB;
  ready: Promise<void>;
}

const g = globalThis as unknown as { __tymoDb?: DbState };

function open(url: string): DbState {
  if (url.startsWith("file:") && !url.includes(":memory:")) {
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  }
  const client = createClient({ url, concurrency: 8 });
  const db = drizzle(client, { schema });
  const ready = (async () => {
    await client.execute("PRAGMA journal_mode = WAL");
    await client.execute("PRAGMA synchronous = NORMAL");
    await migrate(db, { migrationsFolder: config.migrationsDir });
  })();
  return { url, client, db, ready };
}

/** Returns the migrated database, opening it on first use. */
export async function getDb(): Promise<DB> {
  g.__tymoDb ??= open(dbUrl());
  // The state can be swapped while we wait (restore); always return a ready, current db.
  for (;;) {
    const state: DbState = g.__tymoDb;
    await state.ready;
    if (g.__tymoDb === state) return state.db;
  }
}

/** Path of the live SQLite file, or null for remote/in-memory databases. */
export function currentDbPath(): string | null {
  const url = g.__tymoDb?.url ?? dbUrl();
  if (!url.startsWith("file:") || url.includes(":memory:")) return null;
  return url.slice("file:".length);
}

/**
 * Checkpoints and closes the database, runs `fn` (e.g. swapping the file during a restore),
 * then reopens and migrates it. Requests arriving meanwhile wait for the new connection.
 */
export async function withDatabaseClosed(fn: () => Promise<void>) {
  const state = g.__tymoDb;
  const url = state?.url ?? dbUrl();
  if (state) {
    await state.ready.catch(() => {});
    await state.client.execute("PRAGMA wal_checkpoint(TRUNCATE)").catch(() => {});
    state.client.close();
  }
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  // Anyone calling getDb() during the swap blocks on the gate, then gets the new database.
  g.__tymoDb = { url, client: state?.client as Client, db: state?.db as DB, ready: gate };
  try {
    await fn();
  } finally {
    g.__tymoDb = open(url);
    release();
    await g.__tymoDb.ready;
  }
}

/** Test helper: point the app at a fresh database. */
export async function resetDbForTests(url: string): Promise<DB> {
  g.__tymoDb?.client.close();
  g.__tymoDb = open(url);
  await g.__tymoDb.ready;
  return g.__tymoDb.db;
}

export { schema };
