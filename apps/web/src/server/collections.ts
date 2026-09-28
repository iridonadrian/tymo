import { asc, eq, sql } from "drizzle-orm";
import { smartRules, type CollectionInput, type SmartRules } from "@tymo/core";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { reindexSave, rulesSql } from "./search";

export interface CollectionView {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  parentId: string | null;
  smart: boolean;
  rules: SmartRules | null;
  count: number;
}

export async function listCollections(): Promise<CollectionView[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.collections)
    .orderBy(asc(schema.collections.position), asc(schema.collections.name));
  const counts = await db.all<{ collection_id: string; n: number }>(sql`
    SELECT sc.collection_id, count(*) AS n FROM save_collections sc JOIN saves s ON s.id = sc.save_id
    WHERE s.is_archived = 0 GROUP BY sc.collection_id`);
  const countMap = new Map(counts.map((c) => [c.collection_id, c.n]));
  const out: CollectionView[] = [];
  for (const r of rows) {
    const parsed = r.smartRules ? smartRules.safeParse(r.smartRules) : null;
    const rules = parsed?.success ? parsed.data : null;
    let count = countMap.get(r.id) ?? 0;
    if (rules) {
      const [row] = await db.all<{
        n: number;
      }>(sql`SELECT count(*) AS n FROM saves s WHERE s.is_archived = 0 AND (
        s.id IN (SELECT save_id FROM save_collections WHERE collection_id = ${r.id}) OR ${rulesSql(rules)})`);
      count = row?.n ?? 0;
    }
    out.push({
      id: r.id,
      name: r.name,
      icon: r.icon,
      description: r.description,
      parentId: r.parentId,
      smart: !!rules,
      rules,
      count,
    });
  }
  return out;
}

export async function getCollection(id: string) {
  return (await listCollections()).find((c) => c.id === id) ?? null;
}

async function validParent(
  parentId: string | null | undefined,
  selfId?: string,
): Promise<string | null> {
  if (!parentId) return null;
  const db = await getDb();
  // Walk up to prevent cycles (A → B → A).
  let cursor: string | null = parentId;
  for (let i = 0; cursor && i < 20; i++) {
    if (cursor === selfId) throw new Error("A collection can't be nested inside itself");
    const [row] = await db
      .select({ parentId: schema.collections.parentId })
      .from(schema.collections)
      .where(eq(schema.collections.id, cursor));
    if (!row) return i === 0 ? null : parentId;
    cursor = row.parentId;
  }
  return parentId;
}

export async function createCollection(input: CollectionInput & { rules?: SmartRules | null }) {
  const db = await getDb();
  const id = newId();
  await db.insert(schema.collections).values({
    id,
    name: input.name,
    icon: input.icon || null,
    description: input.description || null,
    parentId: await validParent(input.parentId),
    smartRules: input.rules ?? null,
  });
  return id;
}

export async function updateCollection(
  id: string,
  input: Partial<CollectionInput> & { rules?: SmartRules | null },
) {
  const db = await getDb();
  const patch: Partial<typeof schema.collections.$inferInsert> = { updatedAt: Date.now() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.icon !== undefined) patch.icon = input.icon || null;
  if (input.description !== undefined) patch.description = input.description || null;
  if (input.parentId !== undefined) patch.parentId = await validParent(input.parentId, id);
  if (input.rules !== undefined) patch.smartRules = input.rules;
  await db.update(schema.collections).set(patch).where(eq(schema.collections.id, id));
  if (input.name !== undefined) {
    const members = await db
      .select({ id: schema.saveCollections.saveId })
      .from(schema.saveCollections)
      .where(eq(schema.saveCollections.collectionId, id));
    for (const m of members) await reindexSave(db, m.id);
  }
}

export async function deleteCollection(id: string) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const members = await tx
      .select({ id: schema.saveCollections.saveId })
      .from(schema.saveCollections)
      .where(eq(schema.saveCollections.collectionId, id));
    await tx
      .update(schema.collections)
      .set({ parentId: null })
      .where(eq(schema.collections.parentId, id));
    await tx.delete(schema.collections).where(eq(schema.collections.id, id));
    for (const m of members) await reindexSave(tx, m.id);
  });
}

/** Live preview for the smart-collection editor. */
export async function previewRules(rules: SmartRules) {
  const db = await getDb();
  const where = rulesSql(rules);
  const [{ n } = { n: 0 }] = await db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM saves s WHERE s.is_archived = 0 AND ${where}`,
  );
  const sample = await db.all<{
    id: string;
    title: string;
    domain: string | null;
    favicon_url: string | null;
  }>(
    sql`SELECT s.id, s.title, s.domain, s.favicon_url FROM saves s WHERE s.is_archived = 0 AND ${where} ORDER BY s.created_at DESC LIMIT 8`,
  );
  return {
    count: n,
    sample: sample.map((s) => ({
      id: s.id,
      title: s.title,
      domain: s.domain,
      faviconUrl: s.favicon_url,
    })),
  };
}

/** Finds or creates a collection by path of names (used by imports). */
export async function ensureCollectionPath(
  names: string[],
  cache: Map<string, string>,
): Promise<string | null> {
  const db = await getDb();
  let parent: string | null = null;
  let key = "";
  for (const raw of names) {
    const name = raw.trim().slice(0, 80);
    if (!name) continue;
    key += "/" + name.toLowerCase();
    const cached = cache.get(key);
    if (cached) {
      parent = cached;
      continue;
    }
    const [existing] = await db.all<{ id: string }>(
      sql`SELECT id FROM collections WHERE lower(name) = lower(${name}) AND parent_id IS ${parent} LIMIT 1`,
    );
    const id: string = existing?.id ?? (await createCollection({ name, parentId: parent }));
    cache.set(key, id);
    parent = id;
  }
  return parent;
}
