import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests, schema } from "./db";
import { createSave, getSave, reviewSave, serendipityQueue } from "./saves";

const DAY = 86_400_000;

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-serendipity-"));
  await resetDbForTests(`file:${path.join(dir, "s.db")}`);
});

async function age(ids: string[], days: number) {
  const db = await getDb();
  await db
    .update(schema.saves)
    .set({ createdAt: Date.now() - days * DAY })
    .where(inArray(schema.saves.id, ids));
}

describe("serendipity", () => {
  it("queues older saves only, and each decision takes it out of rotation", async () => {
    const old = [];
    for (const t of ["A", "B", "C", "D"]) old.push(await createSave({ title: t, type: "note" }));
    const fresh = await createSave({ title: "Fresh", type: "note" });
    await age(
      old.map((s) => s.id),
      40,
    );

    const q = await serendipityQueue();
    expect(q.map((s) => s.title).sort()).toEqual(["A", "B", "C", "D"]);
    expect(q.some((s) => s.id === fresh.id)).toBe(false);

    const [a, b, c, d] = old.map((s) => s.id) as [string, string, string, string];
    await reviewSave(a, "keep");
    await reviewSave(b, "archive");
    await reviewSave(c, "favorite");
    await reviewSave(d, "snooze");
    expect(await serendipityQueue()).toEqual([]);

    expect((await getSave(b))!.isArchived).toBe(true);
    expect((await getSave(c))!.isFavorite).toBe(true);
    expect((await getSave(d))!.snoozedUntil).toBeGreaterThan(Date.now() + 6 * DAY);
    expect((await getSave(a))!.metadata).toMatchObject({ reviewedAt: expect.any(Number) });

    // A month later, reviewed saves come back (the fresh one is old enough by then too); archived stay out.
    const later = Date.now() + 31 * DAY;
    const db = await getDb();
    await db.update(schema.saves).set({ snoozedUntil: null }).where(eq(schema.saves.id, d));
    const back = (await serendipityQueue(30, later)).map((s) => s.title).sort();
    expect(back).toEqual(["A", "C", "D", "Fresh"]);
  });
});
