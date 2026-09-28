import { describe, expect, it } from "vitest";
import { parseNetscapeBookmarks, toNetscapeBookmarks } from "./bookmarks";

const file = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://github.com/a/b" ADD_DATE="1700000000" TAGS="osint,tools">Repo &amp; stuff</A>
        <DD>A description
        <DT><H3>Security</H3>
        <DL><p>
            <DT><A HREF="https://book.hacktricks.xyz/">HackTricks</A>
            <DT><A HREF="javascript:void(0)">Bookmarklet</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://example.com/">Top</A>
</DL><p>`;

describe("parseNetscapeBookmarks", () => {
  const { items, skipped } = parseNetscapeBookmarks(file);
  it("parses items, folders, tags, dates", () => {
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      url: "https://github.com/a/b",
      title: "Repo & stuff",
      folders: [],
      tags: ["osint", "tools"],
      addDate: 1700000000000,
      description: "A description",
    });
    expect(items[1]).toMatchObject({ title: "HackTricks", folders: ["Security"] });
    expect(items[2]).toMatchObject({ url: "https://example.com/", folders: [] });
    expect(skipped).toBe(1);
  });
  it("round-trips through export", () => {
    const out = toNetscapeBookmarks([
      {
        url: "https://a.com/?x=<y>",
        title: 'A "quoted" <b>',
        tags: ["t"],
        collections: ["C & D"],
        createdAt: 1700000000000,
      },
    ]);
    expect(out).not.toContain("<b>");
    const back = parseNetscapeBookmarks(out).items;
    expect(back[0]).toMatchObject({ title: 'A "quoted" <b>', folders: ["C & D"], tags: ["t"] });
  });
});
