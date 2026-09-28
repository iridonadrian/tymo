import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests, schema } from "./db";
import { createSave, listSaves, setSaveColors } from "./saves";

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-colors-"));
  await resetDbForTests(`file:${path.join(dir, "c.db")}`);
});

describe("colour search", () => {
  it("stores measured colours and filters by colour name or hex", async () => {
    const red = await createSave({ title: "Red chair", type: "image" });
    const blue = await createSave({ title: "Blue sea", type: "image" });
    const none = await createSave({ title: "No image", type: "note" });
    await setSaveColors([
      {
        id: red.id,
        colors: [
          { hex: "#e11d2a", share: 0.6 },
          { hex: "#f5f5f5", share: 0.35 },
          { hex: "#1e40af", share: 0.05 }, // too small to be searchable
        ],
      },
      { id: blue.id, colors: [{ hex: "#1e90ff", share: 0.9 }] },
    ]);

    const ids = async (q: string) => (await listSaves({ q })).items.map((i) => i.title).sort();
    expect(await ids("color:red")).toEqual(["Red chair"]);
    expect(await ids("colour:white")).toEqual(["Red chair"]);
    expect(await ids("color:blue")).toEqual(["Blue sea"]);
    expect(await ids("color:#0066ff")).toEqual(["Blue sea"]);
    expect(await ids("color:red chair")).toEqual(["Red chair"]);
    expect(await ids("color:green")).toEqual([]);

    const items = (await listSaves({})).items;
    expect(items.find((i) => i.id === red.id)!.colors).toEqual(["#e11d2a", "#f5f5f5", "#1e40af"]);
    expect(items.find((i) => i.id === none.id)!.colors).toBeNull();
  });

  it("keeps other metadata when colours are written", async () => {
    const s = await createSave({ title: "Kept", type: "image" });
    const db = await getDb();
    await db
      .update(schema.saves)
      .set({ metadata: { author: "Jane", facts: { kind: "product", price: 5 } } })
      .where(eq(schema.saves.id, s.id));
    await setSaveColors([{ id: s.id, colors: [{ hex: "#228b22", share: 1 }] }]);
    const [row] = await db.select().from(schema.saves).where(eq(schema.saves.id, s.id));
    expect(row!.metadata).toMatchObject({
      author: "Jane",
      colors: ["#228b22"],
      colorNames: ["green"],
    });
    const view = (await listSaves({})).items[0]!;
    expect(view.facts).toEqual({ kind: "product", price: 5 });
  });

  it("treats plain colour words as colour-or-text, and reads natural queries", async () => {
    const chair = await createSave({ title: "Lounge chair", type: "image" });
    await createSave({ title: "Red team playbook", type: "article" });
    await createSave({ title: "Blue chair", type: "image" });
    await setSaveColors([{ id: chair.id, colors: [{ hex: "#d11a2a", share: 0.7 }] }]);

    const titles = async (q: string, natural = false) =>
      (await listSaves({ q, natural })).items.map((i) => i.title).sort();
    expect(await titles("red chair")).toEqual(["Lounge chair"]);
    expect(await titles("red team")).toEqual(["Red team playbook"]);
    expect(await titles("red")).toEqual(["Lounge chair", "Red team playbook"]);

    const res = await listSaves({ q: "red chair photos", natural: true });
    expect(res.interpreted).toBe("type:image red chair");
    expect(res.items.map((i) => i.title)).toEqual(["Lounge chair"]);
    expect((await listSaves({ q: "red chair photos" })).interpreted).toBeUndefined();
    expect(await titles("articles about red teams", true)).toEqual(["Red team playbook"]);
  });

  it("never hands malformed colours or facts to the UI (metadata is API-writable)", async () => {
    const s = await createSave({ title: "Hostile", type: "image" });
    const db = await getDb();
    await db
      .update(schema.saves)
      .set({
        metadata: {
          colors: ["#ff0000", "red; background:url(https://evil.example/x)", 42, "#00ff00"],
          facts: { kind: "product", price: "999", rating: "5" },
        },
      })
      .where(eq(schema.saves.id, s.id));
    const view = (await listSaves({})).items[0]!;
    expect(view.colors).toEqual(["#ff0000", "#00ff00"]);
    expect(view.facts).toEqual({ kind: "product" });
  });
});
