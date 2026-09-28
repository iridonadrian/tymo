/**
 * Link-rot detection (opt-in: Settings → Page archiving → check links). Periodically requests
 * saved URLs through the SSRF-safe fetcher and records the result in
 * `saves.metadata.linkCheck`. A link is only called "broken" after two failed checks in a
 * row (or a definitive 404/410), so a flaky site doesn't get flagged on one bad day.
 */
import { eq, sql } from "drizzle-orm";
import { normalizeUrl } from "@tymo/core";
import { z } from "zod";
import { getDb, schema } from "./db";
import { FetchBlockedError, safeFetchBytes } from "./fetcher";
import { getSetting, setSetting } from "./settings";

const RECHECK_MS = 30 * 86_400_000;
const BATCH = 40;

export type LinkStatus = "ok" | "moved" | "broken" | "error";

export interface LinkCheck {
  status: LinkStatus;
  code: number | null;
  checkedAt: number;
  failures: number;
  finalUrl?: string;
  reason?: string;
}

export const linkCheckSettingsSchema = z.object({ auto: z.boolean().default(false) });

export async function getLinkCheckSettings() {
  const parsed = linkCheckSettingsSchema.safeParse((await getSetting("linkCheck")) ?? {});
  const s = parsed.success ? parsed.data : linkCheckSettingsSchema.parse({});
  const env = process.env.TYMO_LINK_CHECK;
  return { auto: env ? env === "1" : s.auto };
}

export async function saveLinkCheckSettings(input: { auto?: boolean }) {
  const cur = linkCheckSettingsSchema.parse((await getSetting("linkCheck")) ?? {});
  await setSetting("linkCheck", linkCheckSettingsSchema.parse({ ...cur, ...input }));
}

/** Pure classification of one probe, given the previous result. */
export function classify(
  prev: LinkCheck | undefined,
  probe: { code: number | null; finalUrl?: string; error?: string },
  url: string,
  now: number,
): LinkCheck {
  const failures = (prev?.failures ?? 0) + 1;
  if (probe.code !== null && probe.code < 400) {
    const moved =
      probe.finalUrl && normalizeUrl(probe.finalUrl) !== normalizeUrl(url)
        ? probe.finalUrl
        : undefined;
    return {
      status: moved ? "moved" : "ok",
      code: probe.code,
      checkedAt: now,
      failures: 0,
      ...(moved ? { finalUrl: moved } : {}),
    };
  }
  const definitive = probe.code === 404 || probe.code === 410;
  // Anti-bot walls (401/403/429) say nothing about whether the page exists.
  const inconclusive = probe.code === 401 || probe.code === 403 || probe.code === 429;
  return {
    status: inconclusive
      ? (prev?.status ?? "ok")
      : definitive || failures >= 2
        ? "broken"
        : "error",
    code: probe.code,
    checkedAt: now,
    failures: inconclusive ? (prev?.failures ?? 0) : failures,
    reason: probe.error,
  };
}

/** Checks one save's URL and stores the result. Returns null when it can't be checked. */
export async function checkLink(saveId: string, now = Date.now()): Promise<LinkCheck | null> {
  const db = await getDb();
  const [save] = await db
    .select({ url: schema.saves.url, metadata: schema.saves.metadata })
    .from(schema.saves)
    .where(eq(schema.saves.id, saveId));
  if (!save?.url) return null;
  let probe: { code: number | null; finalUrl?: string; error?: string };
  try {
    const res = await safeFetchBytes(save.url, { accept: "*/*", maxBytes: 1024 });
    probe = { code: res.status, finalUrl: res.finalUrl };
  } catch (err) {
    if (err instanceof FetchBlockedError) return null; // private/blocked: not ours to judge
    const code = (err as { cause?: { code?: string } }).cause?.code ?? (err as Error).name;
    probe = { code: null, error: String(code).slice(0, 60) };
  }
  const prev = (save.metadata as { linkCheck?: LinkCheck } | null)?.linkCheck;
  const result = classify(prev, probe, save.url, now);
  const [fresh] = await db
    .select({ metadata: schema.saves.metadata })
    .from(schema.saves)
    .where(eq(schema.saves.id, saveId));
  await db
    .update(schema.saves)
    .set({ metadata: { ...(fresh?.metadata ?? {}), linkCheck: result } })
    .where(eq(schema.saves.id, saveId));
  return result;
}

let running = false;

/** Checks the least recently checked links (never more often than every 30 days per link). */
export async function checkLinksBatch(limit = BATCH, now = Date.now()) {
  if (running) return { checked: 0, broken: 0 };
  running = true;
  try {
    const db = await getDb();
    const rows = await db.all<{ id: string }>(sql`
      SELECT id FROM saves
      WHERE url IS NOT NULL AND is_archived = 0
        AND coalesce(json_extract(metadata, '$.linkCheck.checkedAt'), 0) < ${now - RECHECK_MS}
      ORDER BY coalesce(json_extract(metadata, '$.linkCheck.checkedAt'), 0), created_at
      LIMIT ${limit}`);
    let broken = 0;
    for (const r of rows) {
      const res = await checkLink(r.id, now).catch(() => null);
      if (res?.status === "broken") broken++;
    }
    return { checked: rows.length, broken };
  } finally {
    running = false;
  }
}

export async function maybeScheduledLinkCheck() {
  if (!(await getLinkCheckSettings()).auto) return null;
  return checkLinksBatch();
}

export async function brokenCount() {
  const db = await getDb();
  const [row] = await db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM saves WHERE json_extract(metadata, '$.linkCheck.status') = 'broken' AND is_archived = 0`,
  );
  return row?.n ?? 0;
}
