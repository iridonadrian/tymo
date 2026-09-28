/**
 * Embeddings for semantic search, related saves and near-duplicate detection.
 *
 * Optional (Settings → AI → Semantic search). Vectors live in the `embeddings` table and in
 * an in-memory matrix for brute-force cosine search, which stays well under 50 ms for a
 * personal library (tens of thousands of saves). Every searchable change calls
 * `scheduleEmbedding()` (via `reindexSave`); unchanged text is never re-embedded.
 */
import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { embed, embeddingConfig, type EmbeddingConfig } from "./ai";
import { getDb, schema } from "./db";
import { getAiSettings } from "./settings";
import { publicErrorMessage } from "./privacy";

const BATCH = 32;
const MAX_TEXT = 4000;
const DEBOUNCE_MS = 1500;
const QUERY_TIMEOUT_MS = 6000;

/* ------------------------------------------------------------- vectors */

export function normalize(v: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(v as ArrayLike<number>);
  let n = 0;
  for (let i = 0; i < out.length; i++) n += out[i]! * out[i]!;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i]! /= n;
  return out;
}

export function dot(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < len; i++) s += a[i]! * b[i]!;
  return s;
}

function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function fromBlob(b: ArrayBuffer | Uint8Array): Float32Array {
  // Copy into a fresh, aligned buffer (driver buffers may be pooled or unaligned).
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  return new Float32Array(bytes.slice().buffer, 0, Math.floor(bytes.byteLength / 4));
}

/* ---------------------------------------------------------------- text */

/** The text that represents a save for embedding purposes. */
async function embeddingTexts(ids: string[]): Promise<Map<string, string>> {
  const db = await getDb();
  const idList = sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );
  const rows = await db.all<{
    id: string;
    title: string;
    description: string | null;
    domain: string | null;
    notes: string | null;
    body: string | null;
    extracted_text: string | null;
    ai_summary: string | null;
    tags: string | null;
  }>(sql`
    SELECT s.id, s.title, s.description, s.domain, s.notes, s.body, s.extracted_text, s.ai_summary,
      (SELECT group_concat(t.name, ', ') FROM save_tags st JOIN tags t ON t.id = st.tag_id WHERE st.save_id = s.id) AS tags
    FROM saves s WHERE s.id IN (${idList})`);
  const out = new Map<string, string>();
  for (const r of rows) {
    const text = [
      r.title,
      r.description,
      r.ai_summary,
      r.tags ? `Tags: ${r.tags}` : null,
      r.domain ? `Site: ${r.domain}` : null,
      r.notes,
      (r.body || r.extracted_text || "").slice(0, 2500),
    ]
      .filter((x) => x?.trim())
      .join("\n")
      .slice(0, MAX_TEXT);
    out.set(r.id, text);
  }
  return out;
}

function hashFor(cfg: EmbeddingConfig, text: string) {
  return createHash("sha256").update(cfg.id).update("\n").update(text).digest("hex");
}

/* --------------------------------------------------------------- cache */

interface VectorCache {
  model: string;
  ids: string[];
  vecs: Float32Array[];
  index: Map<string, number>;
}

const g = globalThis as unknown as {
  __tymoVectors?: VectorCache | null;
  __tymoEmbedQueue?: Set<string>;
};
const pending = (g.__tymoEmbedQueue ??= new Set<string>());

async function vectors(model: string): Promise<VectorCache> {
  const cached = g.__tymoVectors;
  if (cached && cached.model === model) return cached;
  const db = await getDb();
  const rows = await db
    .select({ id: schema.embeddings.saveId, vector: schema.embeddings.vector })
    .from(schema.embeddings)
    .where(eq(schema.embeddings.model, model));
  const cache: VectorCache = { model, ids: [], vecs: [], index: new Map() };
  for (const r of rows) {
    cache.index.set(r.id, cache.ids.length);
    cache.ids.push(r.id);
    cache.vecs.push(fromBlob(r.vector));
  }
  g.__tymoVectors = cache;
  return cache;
}

function cachePut(model: string, id: string, vec: Float32Array) {
  const c = g.__tymoVectors;
  if (!c || c.model !== model) return;
  const i = c.index.get(id);
  if (i !== undefined) c.vecs[i] = vec;
  else {
    c.index.set(id, c.ids.length);
    c.ids.push(id);
    c.vecs.push(vec);
  }
}

/** Forgets deleted saves (their rows go with ON DELETE CASCADE). */
export function forgetEmbeddings(ids: string[]) {
  const c = g.__tymoVectors;
  for (const id of ids) pending.delete(id);
  if (!c || !ids.some((id) => c.index.has(id))) return;
  const drop = new Set(ids);
  const keep = c.ids.map((id, i) => [id, c.vecs[i]!] as const).filter(([id]) => !drop.has(id));
  c.ids = keep.map(([id]) => id);
  c.vecs = keep.map(([, v]) => v);
  c.index = new Map(c.ids.map((id, i) => [id, i]));
}

/** Drops cached vectors (after a model change). */
export function invalidateVectorCache() {
  g.__tymoVectors = null;
}

/* --------------------------------------------------------------- queue */

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<number> | null = null;
let lastError: string | null = null;

/** Queues saves for (re-)embedding. Cheap no-op work when semantic search is off. */
export function scheduleEmbedding(ids: string[]) {
  for (const id of ids) pending.add(id);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushEmbeddings().catch(() => {});
  }, DEBOUNCE_MS);
  timer.unref?.();
}

/** Embeds everything queued. Resolves with the number of vectors written. */
export async function flushEmbeddings(): Promise<number> {
  if (running) {
    await running;
    if (!pending.size) return 0;
  }
  running = drain().finally(() => {
    running = null;
  });
  return running;
}

async function drain(): Promise<number> {
  const cfg = embeddingConfig(await getAiSettings());
  if (!cfg) {
    pending.clear();
    return 0;
  }
  const db = await getDb();
  let written = 0;
  while (pending.size) {
    const batch = [...pending].slice(0, BATCH);
    for (const id of batch) pending.delete(id);
    const texts = await embeddingTexts(batch);
    const existing = await db
      .select({ id: schema.embeddings.saveId, hash: schema.embeddings.contentHash })
      .from(schema.embeddings)
      .where(inArray(schema.embeddings.saveId, [...texts.keys()]));
    const known = new Map(existing.map((e) => [e.id, e.hash]));
    const todo = [...texts]
      .map(([id, text]) => ({ id, text, hash: hashFor(cfg, text) }))
      .filter((t) => t.text && known.get(t.id) !== t.hash);
    if (!todo.length) continue;
    let out: number[][];
    try {
      out = await embed(
        todo.map((t) => t.text),
        cfg,
      );
      lastError = null;
    } catch (err) {
      lastError = publicErrorMessage(err, "Embedding request failed");
      console.warn(`[embed] ${lastError}`);
      // Don't hammer a failing provider: drop the rest; "Index library" re-queues later.
      pending.clear();
      break;
    }
    const now = Date.now();
    for (let i = 0; i < todo.length; i++) {
      const t = todo[i]!;
      const vec = normalize(out[i]!);
      const blob = toBlob(vec);
      // The save may have been deleted while we were waiting on the provider.
      await db.run(sql`
        INSERT INTO embeddings (save_id, model, dims, vector, content_hash, updated_at)
        SELECT ${t.id}, ${cfg.id}, ${vec.length}, ${blob}, ${t.hash}, ${now}
        WHERE EXISTS (SELECT 1 FROM saves WHERE id = ${t.id})
        ON CONFLICT(save_id) DO UPDATE SET model = excluded.model, dims = excluded.dims,
          vector = excluded.vector, content_hash = excluded.content_hash, updated_at = excluded.updated_at`);
      cachePut(cfg.id, t.id, vec);
      written++;
    }
  }
  return written;
}

/** Queues every save that has no vector for the current model. Returns how many were queued. */
export async function queueMissingEmbeddings(): Promise<number> {
  const cfg = embeddingConfig(await getAiSettings());
  if (!cfg) return 0;
  const db = await getDb();
  const rows = await db.all<{ id: string }>(sql`
    SELECT s.id FROM saves s
    WHERE NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.save_id = s.id AND e.model = ${cfg.id})
    ORDER BY s.created_at DESC`);
  scheduleEmbedding(rows.map((r) => r.id));
  return rows.length;
}

export async function embeddingStatus() {
  const cfg = embeddingConfig(await getAiSettings());
  const db = await getDb();
  const [row] = await db.all<{ total: number; indexed: number }>(sql`
    SELECT (SELECT count(*) FROM saves) AS total,
      (SELECT count(*) FROM embeddings WHERE model = ${cfg?.id ?? ""}) AS indexed`);
  return {
    enabled: !!cfg,
    model: cfg?.model ?? null,
    total: row?.total ?? 0,
    indexed: row?.indexed ?? 0,
    queued: pending.size,
    lastError,
  };
}

/** Removes vectors from other models (after the user switches models). */
export async function pruneStaleEmbeddings() {
  const cfg = embeddingConfig(await getAiSettings());
  if (!cfg) return;
  const db = await getDb();
  await db.run(sql`DELETE FROM embeddings WHERE model != ${cfg.id}`);
  invalidateVectorCache();
}

/* ------------------------------------------------------------- queries */

export interface Scored {
  id: string;
  score: number;
}

const queryCache = new Map<string, Float32Array>();

async function queryVector(cfg: EmbeddingConfig, text: string): Promise<Float32Array | null> {
  const key = `${cfg.id}\n${text}`;
  const hit = queryCache.get(key);
  if (hit) {
    queryCache.delete(key);
    queryCache.set(key, hit);
    return hit;
  }
  try {
    const [v] = await embed([text], cfg, QUERY_TIMEOUT_MS);
    const vec = normalize(v!);
    queryCache.set(key, vec);
    if (queryCache.size > 200) queryCache.delete(queryCache.keys().next().value!);
    return vec;
  } catch (err) {
    lastError = publicErrorMessage(err, "Embedding request failed");
    return null;
  }
}

function topK(cache: VectorCache, q: Float32Array, k: number, skip?: string): Scored[] {
  const out: Scored[] = [];
  let floor = -Infinity;
  for (let i = 0; i < cache.ids.length; i++) {
    const id = cache.ids[i]!;
    if (id === skip) continue;
    const score = dot(cache.vecs[i]!, q);
    if (out.length < k) {
      out.push({ id, score });
      if (out.length === k) {
        out.sort((a, b) => b.score - a.score);
        floor = out[k - 1]!.score;
      }
    } else if (score > floor) {
      out[k - 1] = { id, score };
      out.sort((a, b) => b.score - a.score);
      floor = out[k - 1]!.score;
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Nearest saves to a free-text query, or null when semantic search is unavailable
 * (disabled, nothing indexed yet, or the provider failed) so callers fall back to FTS.
 */
export async function semanticSearch(text: string, k = 50): Promise<Scored[] | null> {
  const cfg = embeddingConfig(await getAiSettings());
  if (!cfg || !text.trim()) return null;
  const cache = await vectors(cfg.id);
  if (!cache.ids.length) return null;
  const q = await queryVector(cfg, text.trim().slice(0, 500));
  if (!q) return null;
  const hits = topK(cache, q, k);
  // Keep only the head of the distribution: absolute scores vary a lot between models.
  const best = hits[0]?.score ?? 0;
  return hits.filter((h) => h.score >= best - 0.12);
}

/** Saves most similar to the given one, by vector. Null when it has no vector. */
export async function similarTo(saveId: string, k = 6): Promise<Scored[] | null> {
  const cfg = embeddingConfig(await getAiSettings());
  if (!cfg) return null;
  const cache = await vectors(cfg.id);
  const i = cache.index.get(saveId);
  if (i === undefined) return null;
  return topK(cache, cache.vecs[i]!, k, saveId);
}

/**
 * Pairs of saves whose vectors are nearly identical (cosine ≥ threshold).
 * Random-hyperplane LSH keeps this far below O(n²): 8 bands × 8 bits; for cosine 0.93 the
 * chance that a true pair shares at least one band is ≈ 97%.
 */
export async function nearDuplicatePairs(threshold = 0.95, limit = 200) {
  const cfg = embeddingConfig(await getAiSettings());
  if (!cfg) return [];
  const cache = await vectors(cfg.id);
  const n = cache.ids.length;
  if (n < 2) return [];
  const dims = cache.vecs[0]!.length;
  const BANDS = 8;
  const BITS = 8;
  // Deterministic pseudo-random hyperplanes (mulberry32) so results are stable.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
  const planes = Array.from({ length: BANDS * BITS }, () =>
    Float32Array.from({ length: dims }, rand),
  );
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const v = cache.vecs[i]!;
    for (let b = 0; b < BANDS; b++) {
      let sig = 0;
      for (let j = 0; j < BITS; j++) if (dot(v, planes[b * BITS + j]!) > 0) sig |= 1 << j;
      const key = `${b}:${sig}`;
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(i);
    }
  }
  const seen = new Set<string>();
  const pairs: { a: string; b: string; score: number }[] = [];
  for (const members of buckets.values()) {
    if (members.length < 2 || members.length > 400) continue;
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const i = members[x]!;
        const j = members[y]!;
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const score = dot(cache.vecs[i]!, cache.vecs[j]!);
        if (score >= threshold) pairs.push({ a: cache.ids[i]!, b: cache.ids[j]!, score });
      }
    }
  }
  return pairs.sort((p, q) => q.score - p.score).slice(0, limit);
}

/** Test helper. */
export function resetEmbeddingsForTests() {
  pending.clear();
  invalidateVectorCache();
  queryCache.clear();
  lastError = null;
}
