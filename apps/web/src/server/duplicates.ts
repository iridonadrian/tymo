/**
 * Duplicate detection beyond the exact normalized-URL merge done at save time:
 *  - "same page":  different saved URLs that redirect to the same final URL
 *  - "same title": identical (normalized) titles, ignoring generic short ones
 *  - "similar":    near-identical embeddings (only when semantic search is on)
 * Pairs the user marks as "not duplicates" are remembered in settings.
 */
import { sql } from "drizzle-orm";
import { normalizeUrl } from "@tymo/core";
import { getDb } from "./db";
import { nearDuplicatePairs } from "./embeddings";
import { getSetting, setSetting } from "./settings";
import { getSavesByIds, type SaveView } from "./saves";

export type DuplicateReason = "same-page" | "same-title" | "similar";

export interface DuplicatePair {
  key: string;
  reason: DuplicateReason;
  score: number;
  a: SaveView;
  b: SaveView;
}

const DISMISSED_KEY = "duplicates.dismissed";
const MAX_DISMISSED = 5000;
const MAX_GROUP = 6;

export function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function dismissed(): Promise<Set<string>> {
  const v = await getSetting<unknown>(DISMISSED_KEY);
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
}

export async function dismissDuplicate(a: string, b: string) {
  const set = await dismissed();
  set.add(pairKey(a, b));
  await setSetting(DISMISSED_KEY, [...set].slice(-MAX_DISMISSED));
}

type Candidate = { key: string; a: string; b: string; reason: DuplicateReason; score: number };

function pairsFromGroups(
  groups: Map<string, { id: string; createdAt: number }[]>,
  reason: DuplicateReason,
): Candidate[] {
  const out: Candidate[] = [];
  for (const members of groups.values()) {
    if (members.length < 2 || members.length > MAX_GROUP) continue;
    members.sort((x, y) => x.createdAt - y.createdAt);
    // Pair every later save with the oldest one: merging them in turn clears the group.
    for (const m of members.slice(1)) {
      out.push({
        key: pairKey(members[0]!.id, m.id),
        a: members[0]!.id,
        b: m.id,
        reason,
        score: 1,
      });
    }
  }
  return out;
}

export async function findDuplicates(limit = 100): Promise<DuplicatePair[]> {
  const db = await getDb();
  const rows = await db.all<{
    id: string;
    url: string | null;
    final_url: string | null;
    title: string;
    created_at: number;
  }>(
    sql`SELECT id, url, json_extract(metadata, '$.finalUrl') AS final_url, title, created_at FROM saves`,
  );

  const byPage = new Map<string, { id: string; createdAt: number }[]>();
  const byTitle = new Map<string, { id: string; createdAt: number }[]>();
  for (const r of rows) {
    const page = normalizeUrl(r.final_url ?? r.url ?? "");
    if (page)
      (byPage.get(page) ?? byPage.set(page, []).get(page)!).push({
        id: r.id,
        createdAt: r.created_at,
      });
    const t = normalizeTitle(r.title);
    // Short titles ("Home", "Login", "GitHub") are too generic to mean "same thing".
    if (t.length >= 16 && t.includes(" ")) {
      (byTitle.get(t) ?? byTitle.set(t, []).get(t)!).push({ id: r.id, createdAt: r.created_at });
    }
  }

  const skip = await dismissed();
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const add = (c: Candidate) => {
    if (skip.has(c.key) || seen.has(c.key)) return;
    seen.add(c.key);
    candidates.push(c);
  };
  pairsFromGroups(byPage, "same-page").forEach(add);
  pairsFromGroups(byTitle, "same-title").forEach(add);
  for (const p of await nearDuplicatePairs(0.95, limit * 2)) {
    add({ key: pairKey(p.a, p.b), a: p.a, b: p.b, reason: "similar", score: p.score });
  }

  const top = candidates.slice(0, limit);
  const views = new Map(
    (await getSavesByIds([...new Set(top.flatMap((c) => [c.a, c.b]))])).map((v) => [v.id, v]),
  );
  return top
    .map((c) => {
      const a = views.get(c.a);
      const b = views.get(c.b);
      return a && b ? { key: c.key, reason: c.reason, score: c.score, a, b } : null;
    })
    .filter((p): p is DuplicatePair => !!p);
}
