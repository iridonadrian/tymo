import { sql } from "drizzle-orm";
import { toCsv, toMarkdown, type ExportableSave } from "@tymo/core";
import { toNetscapeBookmarks } from "@tymo/core/bookmarks";
import { getDb } from "./db";

export const EXPORT_FORMATS = ["json", "csv", "html", "md"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

type Row = {
  id: string;
  type: string;
  status: string;
  url: string | null;
  title: string;
  description: string | null;
  domain: string | null;
  notes: string | null;
  body: string | null;
  ai_summary: string | null;
  is_favorite: number;
  is_bookmark: number;
  is_archived: number;
  capture_method: string;
  metadata: string | null;
  created_at: number;
  updated_at: number;
  tags: string | null;
  collections: string | null;
};

async function allSaves(): Promise<Row[]> {
  const db = await getDb();
  return db.all<Row>(sql`
    SELECT s.id, s.type, s.status, s.url, s.title, s.description, s.domain, s.notes, s.body, s.ai_summary,
      s.is_favorite, s.is_bookmark, s.is_archived, s.capture_method, s.metadata, s.created_at, s.updated_at,
      (SELECT group_concat(t.name, char(31)) FROM save_tags st JOIN tags t ON t.id = st.tag_id WHERE st.save_id = s.id) AS tags,
      (SELECT group_concat(c.name, char(31)) FROM save_collections sc JOIN collections c ON c.id = sc.collection_id WHERE sc.save_id = s.id) AS collections
    FROM saves s ORDER BY s.created_at ASC`);
}

const split = (v: string | null) => (v ? v.split("\u001f") : []);

export async function exportLibrary(
  format: ExportFormat,
): Promise<{ body: string; mime: string; ext: string }> {
  const rows = await allSaves();
  if (format === "json") {
    const db = await getDb();
    const collections = await db.all(
      sql`SELECT id, name, icon, description, parent_id, smart_rules, created_at FROM collections`,
    );
    const sessions = await db.all<{
      id: string;
      name: string;
      notes: string | null;
      created_at: number;
    }>(sql`SELECT id, name, notes, created_at FROM sessions ORDER BY created_at`);
    const items = await db.all<{
      session_id: string;
      url: string;
      title: string;
      window_index: number;
      position: number;
    }>(
      sql`SELECT session_id, url, title, window_index, position FROM session_items ORDER BY session_id, window_index, position`,
    );
    const body = JSON.stringify(
      {
        format: "tymo-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        collections,
        sessions: sessions.map((s) => ({ ...s, tabs: items.filter((i) => i.session_id === s.id) })),
        saves: rows.map((r) => ({
          id: r.id,
          type: r.type,
          status: r.status,
          url: r.url,
          title: r.title,
          description: r.description,
          notes: r.notes,
          body: r.body,
          aiSummary: r.ai_summary,
          favorite: !!r.is_favorite,
          bookmark: !!r.is_bookmark,
          archived: !!r.is_archived,
          captureMethod: r.capture_method,
          metadata: r.metadata ? JSON.parse(r.metadata) : null,
          tags: split(r.tags),
          collections: split(r.collections),
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      },
      null,
      2,
    );
    return { body, mime: "application/json", ext: "json" };
  }
  const list: ExportableSave[] = rows.map((r) => ({
    url: r.url,
    title: r.title,
    description: r.description,
    notes: r.notes,
    tags: split(r.tags),
    collections: split(r.collections),
    createdAt: r.created_at,
    type: r.type,
    domain: r.domain,
  }));
  if (format === "csv") return { body: toCsv(list), mime: "text/csv", ext: "csv" };
  if (format === "md") return { body: toMarkdown(list), mime: "text/markdown", ext: "md" };
  return { body: toNetscapeBookmarks(list), mime: "text/html", ext: "html" };
}
