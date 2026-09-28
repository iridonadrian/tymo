import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import { importAuto } from "./importer";
import { listSaves } from "./saves";
import { listCollections } from "./collections";

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-imp-"));
  await resetDbForTests(`file:${path.join(dir, "i.db")}`);
});

describe("importAuto", () => {
  it("detects Pocket, Raindrop and Pinboard exports", async () => {
    const pocket = await importAuto(
      "part_000000.csv",
      "title,url,time_added,tags,status\nPost,https://a.dev/,1700000000,ai|read,unread\n",
    );
    expect(pocket).toMatchObject({ format: "Pocket", imported: 1 });

    const raindrop = await importAuto(
      "export.csv",
      "id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite\n1,R,,,https://b.dev/,Dev / Rust,rust,2024-05-01T10:00:00.000Z,,,true\n",
    );
    expect(raindrop).toMatchObject({ format: "Raindrop.io", imported: 1, collections: 2 });

    const pinboard = await importAuto(
      "pinboard.json",
      JSON.stringify([{ href: "https://a.dev/", description: "dup", tags: "x" }]),
    );
    expect(pinboard).toMatchObject({ format: "Pinboard", imported: 0, duplicates: 1 });

    const saves = (await listSaves({ sort: "oldest" })).items;
    expect(saves.map((s) => s.url)).toEqual(["https://a.dev/", "https://b.dev/"]);
    expect(saves[0]!.createdAt).toBe(1_700_000_000_000);
    expect(saves[0]!.tags).toEqual(["ai", "read", "x"]);
    expect(saves[1]!.isFavorite).toBe(true);
    expect((await listCollections()).map((c) => c.name).sort()).toEqual(["Dev", "Rust"]);
  });

  it("still handles bookmarks HTML", async () => {
    const r = await importAuto(
      "bookmarks.html",
      '<DL><p><DT><A HREF="https://c.dev/" ADD_DATE="1700000000">C</A></DL>',
    );
    expect(r).toMatchObject({ format: "Bookmarks HTML", imported: 1 });
  });
});
