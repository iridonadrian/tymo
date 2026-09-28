import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import {
  addBookmarks,
  bulkUpdate,
  createSave,
  getSave,
  libraryStats,
  listBookmarks,
  listSaves,
} from "./saves";
import { ensureCollectionPath } from "./collections";
import { importBookmarksHtml } from "./importer";

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-bookmarks-"));
  await resetDbForTests(`file:${path.join(dir, "b.db")}`);
});

describe("bookmarks", () => {
  it("adds links as bookmarks, merging ones already saved, outside the inbox", async () => {
    const old = await createSave({ url: "https://figma.com/", title: "Figma" });
    const folder = (await ensureCollectionPath(["Design"], new Map()))!;
    const r = await addBookmarks(
      [
        { url: "https://figma.com/", title: "Figma" },
        { url: "https://linear.app/", title: "Linear" },
      ],
      folder,
    );
    expect(r).toMatchObject({ added: 1, existing: 1 });
    expect(r.enrich).toHaveLength(1);

    const items = await listBookmarks();
    expect(items.map((b) => [b.title, b.folder?.name])).toEqual([
      ["Figma", "Design"],
      ["Linear", "Design"],
    ]);
    const merged = (await getSave(old.id))!;
    expect(merged).toMatchObject({ isBookmark: true, status: "active" });

    expect((await listSaves({ q: "is:bookmark" })).total).toBe(2);
    expect((await libraryStats()).bookmarks).toBe(2);
    expect((await listSaves({ view: "inbox" })).total).toBe(0);
  });

  it("toggles with bulk actions and leaves notes out", async () => {
    const a = await createSave({ url: "https://news.ycombinator.com/", title: "HN" });
    const n = await createSave({ type: "note", title: "A note", body: "x" });
    await bulkUpdate([a.id, n.id], { kind: "bookmark" });
    // Notes have no URL, so they can't be on a launcher page.
    expect((await listBookmarks()).map((b) => b.title)).toEqual(["HN"]);
    expect((await getSave(a.id))!.status).toBe("active");
    await bulkUpdate([a.id], { kind: "unbookmark" });
    expect(await listBookmarks()).toEqual([]);
    await bulkUpdate([n.id], { kind: "archive" });
  });

  it("imports browser bookmark files as bookmarks, keeping folders", async () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
      <DL><p>
        <DT><H3>Tools</H3>
        <DL><p><DT><A HREF="https://regex101.com/" ADD_DATE="1700000000">regex101</A></DL><p>
        <DT><A HREF="https://example.org/">Example</A>
      </DL><p>`;
    const r = await importBookmarksHtml(html);
    expect(r.imported).toBe(2);
    const items = await listBookmarks();
    expect(items.map((b) => [b.title, b.folder?.name ?? null])).toEqual([
      ["Example", null],
      ["regex101", "Tools"],
    ]);
  });
});
