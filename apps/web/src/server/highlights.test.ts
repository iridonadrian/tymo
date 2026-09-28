import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import { bulkUpdate, createSave, getSave, highlightsFor, listSaves, saveHighlight } from "./saves";

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-highlights-"));
  await resetDbForTests(`file:${path.join(dir, "h.db")}`);
});

const URL = "https://blog.example.com/posts/fts?utm_source=x";

describe("highlights", () => {
  it("saves quotes linked to the passage without merging them into the page", async () => {
    const page = await createSave({ url: URL, title: "How FTS works", type: "article" });
    const text = "The best search index is the one you do not have to operate.";
    const h = await saveHighlight(page.id, text);
    expect(h.duplicate).toBe(false);

    const quote = (await getSave(h.id))!;
    expect(quote.type).toBe("quote");
    expect(quote.status).toBe("active"); // highlights skip the Inbox
    expect(quote.title).toBe("The best search index is the one you do not have to…");
    expect(quote.url).toBe(
      "https://blog.example.com/posts/fts#:~:text=The%20best%20search%20index%20is,do%20not%20have%20to%20operate.",
    );
    expect(quote.metadata).toMatchObject({ sourceSaveId: page.id, sourceTitle: "How FTS works" });

    // Saving the page again still finds the page, not the quote.
    const again = await createSave({ url: "https://blog.example.com/posts/fts" });
    expect(again).toMatchObject({ id: page.id, duplicate: true });

    // Quotes saved elsewhere (browser extension) are matched by their source URL.
    await createSave({
      type: "quote",
      title: "Second",
      body: "Prefix queries match search, searching and searches.",
      url: "https://blog.example.com/posts/fts#:~:text=Prefix",
      metadata: { sourceUrl: "https://www.blog.example.com/posts/fts/" },
    });
    await createSave({
      type: "quote",
      title: "Elsewhere",
      body: "Unrelated passage from another page entirely.",
      metadata: { sourceUrl: "https://other.example.com/" },
    });
    expect((await highlightsFor(page.id)).map((x) => x.text)).toEqual([
      text,
      "Prefix queries match search, searching and searches.",
    ]);

    // Removing (archiving) hides it from the page; quotes are searchable like any save.
    await bulkUpdate([h.id], { kind: "archive" });
    expect(await highlightsFor(page.id)).toHaveLength(1);
    expect((await listSaves({ q: "prefix queries" })).items.map((i) => i.type)).toEqual(["quote"]);
  });

  it("rejects empty highlights and unknown pages", async () => {
    const page = await createSave({ title: "Note", type: "note", body: "x" });
    await expect(saveHighlight(page.id, "   ")).rejects.toThrow(/Select some text/);
    await expect(saveHighlight("nope", "text")).rejects.toThrow(/not found/);
  });
});
