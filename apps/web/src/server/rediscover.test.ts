import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests, schema } from "./db";
import { createSave, getSave, readMinutes, rediscover } from "./saves";

const DAY = 86_400_000;

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-redis-"));
  await resetDbForTests(`file:${path.join(dir, "r.db")}`);
});

describe("rediscover", () => {
  it("surfaces old, unopened, unarchived saves with a stable daily pick", async () => {
    const now = Date.now();
    const old = await createSave({ title: "Old gem", type: "note" }, { createdAt: now - 90 * DAY });
    const opened = await createSave(
      { title: "Old but opened", type: "note" },
      { createdAt: now - 90 * DAY },
    );
    const archived = await createSave(
      { title: "Old archived", type: "note" },
      { createdAt: now - 90 * DAY },
    );
    await createSave({ title: "Fresh", type: "note" }, { createdAt: now - DAY });
    const db = await getDb();
    await db
      .update(schema.saves)
      .set({ lastOpenedAt: now - DAY })
      .where(eq(schema.saves.id, opened.id));
    await db.update(schema.saves).set({ isArchived: true }).where(eq(schema.saves.id, archived.id));

    const picks = await rediscover(4, now);
    expect(picks.map((p) => p.id)).toEqual([old.id]);
    expect((await rediscover(4, now)).map((p) => p.id)).toEqual(picks.map((p) => p.id));
  });

  it("estimates reading time for text-heavy saves only", async () => {
    expect(readMinutes("article", 1000)).toBeNull();
    expect(readMinutes("article", 5500)).toBe(5);
    expect(readMinutes("video", 50_000)).toBeNull();
    // The reader's word count wins over the character estimate.
    expect(readMinutes("article", 9000, 301)).toBe(1);
    expect(readMinutes("article", 9000, 120)).toBeNull();
    expect(readMinutes("article", 100, 2300)).toBe(10);
    const { id } = await createSave({ title: "Essay", type: "note", body: "word ".repeat(2000) });
    expect((await getSave(id))!.readMinutes).toBe(9);
  });
});
