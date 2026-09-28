import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests, schema } from "./db";
import { bulkUpdate, createSave, getSave, libraryStats, listSaves } from "./saves";

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-snooze-"));
  await resetDbForTests(`file:${path.join(dir, "s.db")}`);
});

describe("snooze", () => {
  it("hides saves from the inbox until the time comes", async () => {
    const a = await createSave({ title: "Read later", type: "note" });
    const b = await createSave({ title: "Now", type: "note" });
    await bulkUpdate([a.id], { kind: "snooze", until: Date.now() + 86_400_000 });

    expect((await listSaves({ view: "inbox" })).items.map((i) => i.id)).toEqual([b.id]);
    expect((await listSaves({ q: "in:inbox" })).items.map((i) => i.id)).toEqual([b.id]);
    expect((await listSaves({ q: "is:snoozed" })).items.map((i) => i.id)).toEqual([a.id]);
    expect((await listSaves({})).items).toHaveLength(2); // still in the library
    expect(await libraryStats()).toMatchObject({ inbox: 1, snoozed: 1 });
    expect((await getSave(a.id))!.snoozedUntil).toBeGreaterThan(Date.now());

    // Time passes: it's back.
    const db = await getDb();
    await db
      .update(schema.saves)
      .set({ snoozedUntil: Date.now() - 1 })
      .where(eq(schema.saves.id, a.id));
    expect((await listSaves({ view: "inbox" })).items).toHaveLength(2);
    expect((await getSave(a.id))!.snoozedUntil).toBeNull();
  });

  it("done, archive and unsnooze clear it; snoozing a filed save returns it to the inbox", async () => {
    const a = await createSave({ title: "A", type: "note" });
    await bulkUpdate([a.id], { kind: "done" });
    await bulkUpdate([a.id], { kind: "snooze", until: Date.now() + 60_000 });
    expect((await getSave(a.id))!.status).toBe("inbox");
    await bulkUpdate([a.id], { kind: "snooze", until: null });
    expect((await listSaves({ view: "inbox" })).items).toHaveLength(1);
    await bulkUpdate([a.id], { kind: "snooze", until: Date.now() + 60_000 });
    await bulkUpdate([a.id], { kind: "done" });
    expect((await getSave(a.id))!.snoozedUntil).toBeNull();
  });
});
