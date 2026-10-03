/**
 * Change capture: SQLite triggers write every insert, update and delete of a synced table
 * to sync_outbox, so no code path that changes the library can forget to sync. They are
 * (re)created at startup from the live columns, so new columns are picked up after a
 * migration. While remote changes are being applied, sync_state.muted = 1 silences them.
 */
import { sql } from "drizzle-orm";
import type { Executor } from "../db";
import { SPECS, SYNC_TABLES, syncedColumns, type SyncTable } from "./tables";

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const NOT_MUTED = "coalesce((SELECT muted FROM sync_state WHERE id = 1), 0) = 0";

function pkExpr(table: SyncTable, side: "NEW" | "OLD") {
  return SPECS[table].pk.map((c) => `${side}.${q(c)}`).join(" || '|' || ");
}

export async function installTriggers(db: Executor) {
  await db.run(sql`INSERT OR IGNORE INTO sync_state (id, muted) VALUES (1, 0)`);
  await db.run(sql`UPDATE sync_state SET muted = 0 WHERE id = 1`);
  for (const table of SYNC_TABLES) {
    const cols = await syncedColumns(db, table);
    const changed = cols
      .map((c) => `CASE WHEN OLD.${q(c)} IS NOT NEW.${q(c)} THEN '${c}' END`)
      .join(", ");
    const anyChange = cols.map((c) => `OLD.${q(c)} IS NOT NEW.${q(c)}`).join(" OR ");
    await dropTriggersFor(db, table);
    await db.run(
      sql.raw(`CREATE TRIGGER ${q(`tymo_sync_${table}_i`)} AFTER INSERT ON ${q(table)}
        WHEN ${NOT_MUTED}
        BEGIN INSERT INTO sync_outbox (tbl, pk, op) VALUES ('${table}', ${pkExpr(table, "NEW")}, 'i'); END`),
    );
    await db.run(
      sql.raw(`CREATE TRIGGER ${q(`tymo_sync_${table}_u`)} AFTER UPDATE ON ${q(table)}
        WHEN ${NOT_MUTED} AND (${anyChange})
        BEGIN INSERT INTO sync_outbox (tbl, pk, op, cols)
          VALUES ('${table}', ${pkExpr(table, "NEW")}, 'u', json_array(${changed})); END`),
    );
    await db.run(
      sql.raw(`CREATE TRIGGER ${q(`tymo_sync_${table}_d`)} AFTER DELETE ON ${q(table)}
        WHEN ${NOT_MUTED}
        BEGIN INSERT INTO sync_outbox (tbl, pk, op) VALUES ('${table}', ${pkExpr(table, "OLD")}, 'd'); END`),
    );
  }
}

async function dropTriggersFor(db: Executor, table: SyncTable) {
  for (const op of ["i", "u", "d"])
    await db.run(sql.raw(`DROP TRIGGER IF EXISTS ${q(`tymo_sync_${table}_${op}`)}`));
}

export async function removeTriggers(db: Executor) {
  for (const table of SYNC_TABLES) await dropTriggersFor(db, table);
}

/** Queues every row of the library for this device's first sync (op "s": snapshot). */
export async function queueEverything(db: Executor) {
  for (const table of SYNC_TABLES) {
    await db.run(
      sql.raw(`INSERT INTO sync_outbox (tbl, pk, op)
        SELECT '${table}', ${SPECS[table].pk.map((c) => q(c)).join(" || '|' || ")}, 's' FROM ${q(table)}`),
    );
  }
}
