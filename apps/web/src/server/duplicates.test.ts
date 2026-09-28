import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests, schema } from "./db";
import { createSave, getSave, listSaves, mergeSaves, updateSave } from "./saves";
import { createCollection } from "./collections";
import { createSession, getSession } from "./sessions";
import { dismissDuplicate, findDuplicates, normalizeTitle } from "./duplicates";

let n = 0;
beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-dup-"));
  await resetDbForTests(`file:${path.join(dir, `d${n++}.db`)}`);
});

describe("duplicates", () => {
  it("normalizes titles", () => {
    expect(normalizeTitle("  Hello, Wörld — Guide!! ")).toBe("hello world guide");
  });

  it("finds same-page and same-title pairs, and remembers dismissals", async () => {
    const a = await createSave({ url: "https://example.com/short", title: "Short link" });
    const b = await createSave({ url: "https://example.com/article-long", title: "Article" });
    const db = await getDb();
    await db
      .update(schema.saves)
      .set({ metadata: { finalUrl: "https://example.com/article-long" } })
      .where(eq(schema.saves.id, a.id));
    const c = await createSave({ url: "https://a.dev/x", title: "The Complete Guide to Rust" });
    const d = await createSave({ url: "https://b.dev/y", title: "The complete guide to Rust!" });
    await createSave({ url: "https://c.dev/", title: "Home" });
    await createSave({ url: "https://d.dev/", title: "Home" });

    const pairs = await findDuplicates();
    expect(pairs.map((p) => p.reason).sort()).toEqual(["same-page", "same-title"]);
    const page = pairs.find((p) => p.reason === "same-page")!;
    expect([page.a.id, page.b.id].sort()).toEqual([a.id, b.id].sort());
    const title = pairs.find((p) => p.reason === "same-title")!;
    expect([title.a.id, title.b.id].sort()).toEqual([c.id, d.id].sort());

    await dismissDuplicate(d.id, c.id);
    expect((await findDuplicates()).map((p) => p.reason)).toEqual(["same-page"]);
  });

  it("merges tags, collections, notes, sessions and stats into the kept save", async () => {
    const colId = await createCollection({ name: "Reading" });
    const keep = await createSave({ url: "https://k.dev/", title: "Keep", tags: ["one"] });
    const drop = await createSave({
      url: "https://d.dev/",
      title: "Drop",
      tags: ["two"],
      notes: "from the duplicate",
      favorite: true,
      collectionIds: [colId],
    });
    await updateSave(keep.id, { notes: "original" });
    const session = await createSession({
      name: "Research",
      tabs: [{ url: "https://d.dev/", title: "Drop", windowIndex: 0 }],
    });

    await mergeSaves(keep.id, drop.id);
    const merged = (await getSave(keep.id))!;
    expect(await getSave(drop.id)).toBeNull();
    expect(merged.tags).toEqual(["one", "two"]);
    expect(merged.collections.map((c) => c.id)).toEqual([colId]);
    expect(merged.notes).toBe("original\n\nfrom the duplicate");
    expect(merged.isFavorite).toBe(true);
    expect(merged.status).toBe("active");
    const s = await getSession(session.id);
    expect(s!.items.every((i) => i.saveId === keep.id)).toBe(true);
    // The kept save is searchable by the merged tag; the dropped one is gone from the index.
    expect((await listSaves({ q: "#two" })).items.map((i) => i.id)).toEqual([keep.id]);
    expect((await listSaves({ q: "Drop" })).items).toHaveLength(0);
    await expect(mergeSaves(keep.id, keep.id)).rejects.toThrow();
  });
});
