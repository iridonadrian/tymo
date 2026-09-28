import { asc, desc, eq, sql } from "drizzle-orm";
import { isHttpUrl, type CreateSessionInput } from "@tymo/core";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { insertSave } from "./saves";
import { enqueueEnrichment } from "./enrich";

export function defaultSessionName(date = new Date()) {
  const d = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const t = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `Session — ${d}, ${t}`;
}

export async function createSession(input: CreateSessionInput) {
  const db = await getDb();
  const tabs = input.tabs.filter((t) => isHttpUrl(t.url));
  const skipped = input.tabs.length - tabs.length;
  if (!tabs.length)
    throw new Error("None of these tabs can be saved (only http/https pages are supported).");

  const toEnrich: string[] = [];
  const sessionId = newId();
  await db.transaction(
    async (tx) => {
      await tx.insert(schema.sessions).values({
        id: sessionId,
        name: input.name?.trim() || defaultSessionName(),
        notes: input.notes?.trim() || null,
        browser: input.browser ?? null,
        tabCount: tabs.length,
      });
      let position = 0;
      for (const tab of tabs) {
        const favicon = tab.faviconUrl && isHttpUrl(tab.faviconUrl) ? tab.faviconUrl : undefined;
        const r = await insertSave(
          tx,
          { url: tab.url, title: tab.title?.slice(0, 500), faviconUrl: favicon, tags: input.tags },
          { status: "active", captureMethod: "extension-session" },
        );
        if (r.needsEnrichment) toEnrich.push(r.id);
        await tx.insert(schema.sessionItems).values({
          id: newId(),
          sessionId,
          saveId: r.id,
          position: position++,
          windowIndex: tab.windowIndex,
          url: tab.url,
          title: tab.title?.slice(0, 500) || tab.url,
          faviconUrl: favicon ?? null,
          pinned: tab.pinned ?? false,
          groupTitle: tab.groupTitle ?? null,
          groupColor: tab.groupColor ?? null,
        });
      }
    },
    { behavior: "immediate" },
  );
  enqueueEnrichment(toEnrich);
  return { id: sessionId, saved: tabs.length, skipped };
}

export interface SessionSummary {
  id: string;
  name: string;
  notes: string | null;
  tabCount: number;
  createdAt: number;
  lastRestoredAt: number | null;
  windows: number;
  favicons: string[];
  domains: string[];
}

export async function listSessions(limit = 100): Promise<SessionSummary[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.sessions)
    .orderBy(desc(schema.sessions.createdAt))
    .limit(limit);
  if (!rows.length) return [];
  const extras = await db.all<{
    session_id: string;
    windows: number;
    favicons: string | null;
    domains: string | null;
  }>(sql`
    SELECT si.session_id, count(DISTINCT si.window_index) AS windows,
      (SELECT group_concat(f, char(31)) FROM (SELECT DISTINCT x.favicon_url AS f FROM session_items x
         WHERE x.session_id = si.session_id AND x.favicon_url IS NOT NULL LIMIT 6)) AS favicons,
      (SELECT group_concat(d, char(31)) FROM (SELECT s.domain AS d, count(*) AS c FROM session_items x JOIN saves s ON s.id = x.save_id
         WHERE x.session_id = si.session_id AND s.domain IS NOT NULL GROUP BY s.domain ORDER BY c DESC LIMIT 4)) AS domains
    FROM session_items si
    WHERE si.session_id IN (${sql.join(
      rows.map((r) => sql`${r.id}`),
      sql`, `,
    )})
    GROUP BY si.session_id`);
  const map = new Map(extras.map((e) => [e.session_id, e]));
  return rows.map((r) => {
    const e = map.get(r.id);
    return {
      id: r.id,
      name: r.name,
      notes: r.notes,
      tabCount: r.tabCount,
      createdAt: r.createdAt,
      lastRestoredAt: r.lastRestoredAt,
      windows: e?.windows ?? 1,
      favicons: e?.favicons?.split("\u001f") ?? [],
      domains: e?.domains?.split("\u001f") ?? [],
    };
  });
}

export async function getSession(id: string) {
  const db = await getDb();
  const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
  if (!session) return null;
  const items = await db
    .select({
      id: schema.sessionItems.id,
      saveId: schema.sessionItems.saveId,
      position: schema.sessionItems.position,
      windowIndex: schema.sessionItems.windowIndex,
      url: schema.sessionItems.url,
      title: sql<string>`coalesce(${schema.saves.title}, ${schema.sessionItems.title})`,
      faviconUrl: sql<
        string | null
      >`coalesce(${schema.saves.faviconUrl}, ${schema.sessionItems.faviconUrl})`,
      pinned: schema.sessionItems.pinned,
      groupTitle: schema.sessionItems.groupTitle,
      groupColor: schema.sessionItems.groupColor,
    })
    .from(schema.sessionItems)
    .leftJoin(schema.saves, eq(schema.saves.id, schema.sessionItems.saveId))
    .where(eq(schema.sessionItems.sessionId, id))
    .orderBy(asc(schema.sessionItems.windowIndex), asc(schema.sessionItems.position));
  return { ...session, items };
}

export async function updateSession(id: string, input: { name?: string; notes?: string | null }) {
  const db = await getDb();
  await db
    .update(schema.sessions)
    .set({
      ...(input.name !== undefined
        ? { name: input.name.trim().slice(0, 200) || defaultSessionName() }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      updatedAt: Date.now(),
    })
    .where(eq(schema.sessions.id, id));
}

export async function markSessionRestored(id: string) {
  const db = await getDb();
  await db
    .update(schema.sessions)
    .set({ lastRestoredAt: Date.now() })
    .where(eq(schema.sessions.id, id));
}

/** Deletes the session. Saves created by it remain in the library. */
export async function deleteSession(id: string) {
  const db = await getDb();
  await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
}
