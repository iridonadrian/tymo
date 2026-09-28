import { sql, type SQL } from "drizzle-orm";
import type { ParsedQuery, RuleCondition, SmartRules } from "@tymo/core";
import { ftsWord, toFtsMatch } from "@tymo/core";
import type { Executor } from "./db";
import { scheduleEmbedding } from "./embeddings";

/** Rebuilds the FTS row for one save (rowid = saves.seq) and queues its embedding. */
export async function reindexSave(db: Executor, saveId: string) {
  const rows = await db.all<{
    seq: number;
    title: string;
    description: string | null;
    url: string | null;
    domain: string | null;
    notes: string | null;
    body: string | null;
    extracted_text: string | null;
    ai_summary: string | null;
    image_description: string | null;
    tags: string | null;
    collections: string | null;
  }>(sql`
    SELECT s.seq, s.title, s.description, s.url, s.domain, s.notes, s.body, s.extracted_text, s.ai_summary,
      json_extract(s.metadata, '$.imageDescription') AS image_description,
      (SELECT group_concat(t.name, ' ') FROM save_tags st JOIN tags t ON t.id = st.tag_id WHERE st.save_id = s.id) AS tags,
      (SELECT group_concat(c.name, ' ') FROM save_collections sc JOIN collections c ON c.id = sc.collection_id WHERE sc.save_id = s.id) AS collections
    FROM saves s WHERE s.id = ${saveId}`);
  const r = rows[0];
  if (!r) return;
  await db.run(sql`DELETE FROM saves_fts WHERE rowid = ${r.seq}`);
  await db.run(sql`INSERT INTO saves_fts(rowid, title, description, url, tags, notes, body) VALUES (
    ${r.seq},
    ${r.title},
    ${[r.description, r.ai_summary, r.image_description].filter(Boolean).join("\n")},
    ${[r.url, r.domain].filter(Boolean).join(" ")},
    ${[r.tags, r.collections].filter(Boolean).join(" ")},
    ${r.notes ?? ""},
    ${[r.body, r.extracted_text].filter(Boolean).join("\n").slice(0, 60_000)}
  )`);
  scheduleEmbedding([saveId]);
}

export async function removeFromIndex(db: Executor, seqs: number[]) {
  if (!seqs.length) return;
  await db.run(
    sql`DELETE FROM saves_fts WHERE rowid IN (${sql.join(
      seqs.map((s) => sql`${s}`),
      sql`, `,
    )})`,
  );
}

function likeEscape(v: string) {
  return "%" + v.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
}

function conditionSql(c: RuleCondition): SQL {
  const neg = c.op === "is_not" || c.op === "not_contains";
  const contains = c.op === "contains" || c.op === "not_contains";
  const v = c.value.trim();
  let inner: SQL;
  const textCmp = (col: SQL) =>
    contains ? sql`${col} LIKE ${likeEscape(v)} ESCAPE '\\'` : sql`lower(${col}) = lower(${v})`;
  switch (c.field) {
    case "tag": {
      const name = v.toLowerCase().replace(/^#/, "");
      inner = sql`EXISTS (SELECT 1 FROM save_tags st JOIN tags t ON t.id = st.tag_id WHERE st.save_id = s.id AND ${
        contains ? sql`t.name LIKE ${likeEscape(name)} ESCAPE '\\'` : sql`t.name = ${name}`
      })`;
      break;
    }
    case "domain":
      inner = textCmp(sql`coalesce(s.domain, '')`);
      break;
    case "type":
      inner = textCmp(sql`s.type`);
      break;
    case "title":
      inner = textCmp(sql`s.title`);
      break;
    case "url":
      inner = textCmp(sql`coalesce(s.url, '')`);
      break;
    case "text":
      inner = textCmp(
        sql`(s.title || ' ' || coalesce(s.description, '') || ' ' || coalesce(s.notes, '') || ' ' || coalesce(s.url, ''))`,
      );
      break;
  }
  return neg ? sql`NOT (${inner})` : inner;
}

/** Compiles smart-collection rules (DNF) to a WHERE fragment over alias `s`. */
export function rulesSql(rules: SmartRules): SQL {
  const groups = rules.groups.map((g) => sql`(${sql.join(g.map(conditionSql), sql` AND `)})`);
  return sql`(${sql.join(groups, sql` OR `)})`;
}

/** Filters from a parsed query (everything except the FTS text part). */
export function queryFiltersSql(q: ParsedQuery): SQL[] {
  const where: SQL[] = [];
  for (const tag of q.tags) {
    where.push(
      sql`EXISTS (SELECT 1 FROM save_tags st JOIN tags t ON t.id = st.tag_id WHERE st.save_id = s.id AND t.name = ${tag})`,
    );
  }
  if (q.domains.length) {
    where.push(
      sql`(${sql.join(
        q.domains.map((d) => sql`s.domain LIKE ${likeEscape(d)} ESCAPE '\\'`),
        sql` OR `,
      )})`,
    );
  }
  if (q.types.length)
    where.push(
      sql`s.type IN (${sql.join(
        q.types.map((t) => sql`${t}`),
        sql`, `,
      )})`,
    );
  for (const name of q.collections) {
    where.push(sql`EXISTS (SELECT 1 FROM save_collections sc JOIN collections c ON c.id = sc.collection_id
      WHERE sc.save_id = s.id AND lower(c.name) = lower(${name}))`);
  }
  for (const c of q.colors) {
    where.push(
      sql`EXISTS (SELECT 1 FROM json_each(coalesce(s.metadata, '{}'), '$.colorNames') j WHERE j.value = ${c})`,
    );
  }
  for (const { color, word } of q.softColors) {
    const fts = ftsWord(word);
    where.push(
      sql`(EXISTS (SELECT 1 FROM json_each(coalesce(s.metadata, '{}'), '$.colorNames') j WHERE j.value = ${color})${
        fts ? sql` OR s.seq IN (SELECT rowid FROM saves_fts WHERE saves_fts MATCH ${fts})` : sql``
      })`,
    );
  }
  if (q.inbox) {
    where.push(sql`s.status = 'inbox'`);
    if (!q.snoozed) where.push(sql`(s.snoozed_until IS NULL OR s.snoozed_until <= ${Date.now()})`);
  }
  if (q.snoozed) where.push(sql`s.snoozed_until > ${Date.now()}`);
  if (q.broken) where.push(sql`json_extract(s.metadata, '$.linkCheck.status') = 'broken'`);
  if (q.favorite) where.push(sql`s.is_favorite = 1`);
  if (q.bookmark) where.push(sql`s.is_bookmark = 1`);
  if (q.unread) where.push(sql`s.last_opened_at IS NULL`);
  if (q.before !== undefined) where.push(sql`s.created_at < ${q.before}`);
  if (q.after !== undefined) where.push(sql`s.created_at > ${q.after}`);
  // Exclusions also apply when there is no positive text (pure filter queries).
  if (!q.terms.length && !q.phrases.length && q.excluded.length) {
    for (const ex of q.excluded) where.push(sql`s.title NOT LIKE ${likeEscape(ex)} ESCAPE '\\'`);
  }
  return where;
}

export function ftsMatch(q: ParsedQuery): string | null {
  return toFtsMatch(q);
}
