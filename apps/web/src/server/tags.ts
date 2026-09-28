import { sql, eq } from "drizzle-orm";
import { normalizeTag } from "@tymo/core";
import { getDb, schema } from "./db";
import { reindexSave } from "./search";

export async function listTags() {
  const db = await getDb();
  return db.all<{ id: string; name: string; count: number }>(sql`
    SELECT t.id, t.name, count(s.id) AS count FROM tags t
    LEFT JOIN save_tags st ON st.tag_id = t.id
    LEFT JOIN saves s ON s.id = st.save_id AND s.is_archived = 0
    GROUP BY t.id ORDER BY count DESC, t.name ASC`);
}

export async function renameTag(id: string, newName: string) {
  const name = normalizeTag(newName);
  if (!name) throw new Error("Invalid tag name");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [target] = await tx.select().from(schema.tags).where(eq(schema.tags.name, name));
    const members = await tx
      .select({ saveId: schema.saveTags.saveId })
      .from(schema.saveTags)
      .where(eq(schema.saveTags.tagId, id));
    if (target && target.id !== id) {
      // Merge into the existing tag.
      await tx.run(
        sql`INSERT OR IGNORE INTO save_tags (save_id, tag_id) SELECT save_id, ${target.id} FROM save_tags WHERE tag_id = ${id}`,
      );
      await tx.delete(schema.tags).where(eq(schema.tags.id, id));
    } else {
      await tx.update(schema.tags).set({ name }).where(eq(schema.tags.id, id));
    }
    for (const m of members) await reindexSave(tx, m.saveId);
  });
}

export async function deleteTag(id: string) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const members = await tx
      .select({ saveId: schema.saveTags.saveId })
      .from(schema.saveTags)
      .where(eq(schema.saveTags.tagId, id));
    await tx.delete(schema.tags).where(eq(schema.tags.id, id));
    for (const m of members) await reindexSave(tx, m.saveId);
  });
}
