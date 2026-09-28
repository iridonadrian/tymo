import { describe, expect, it } from "vitest";
import { parseCsv, parsePinboardJson, parseServiceCsv, parseWhen } from "./services-import";

describe("service imports", () => {
  it("parses RFC 4180 CSV", () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","he said ""hi""\nbye"\n\n')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"\nbye'],
    ]);
  });

  it("reads dates in seconds, ms and ISO", () => {
    expect(parseWhen("1700000000")).toBe(1_700_000_000_000);
    expect(parseWhen("1700000000000")).toBe(1_700_000_000_000);
    expect(parseWhen("2024-01-02T03:04:05Z")).toBe(Date.UTC(2024, 0, 2, 3, 4, 5));
    expect(parseWhen("soon")).toBeUndefined();
  });

  it("imports Pocket", () => {
    const r = parseServiceCsv(
      "title,url,time_added,tags,status\nGreat post,https://a.dev/x,1700000000,ai|reading,unread\nBad,javascript:alert(1),1,,unread\n",
    );
    expect(r.format).toBe("pocket");
    expect(r.skipped).toBe(1);
    expect(r.items[0]).toMatchObject({
      url: "https://a.dev/x",
      title: "Great post",
      tags: ["ai", "reading"],
      addDate: 1_700_000_000_000,
    });
  });

  it("imports Raindrop with folders, notes and favorites", () => {
    const r = parseServiceCsv(
      'id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite\n1,Rust book,my note,An excerpt,https://doc.rust-lang.org/book/,Dev / Rust,"rust, books",2024-05-01T10:00:00.000Z,,,true\n2,Loose,,,https://b.dev/,Unsorted,,2024-05-01T10:00:00.000Z,,,false\n',
    );
    expect(r.format).toBe("raindrop");
    expect(r.items[0]).toMatchObject({
      title: "Rust book",
      description: "An excerpt",
      notes: "my note",
      folders: ["Dev", "Rust"],
      tags: ["rust", "books"],
      favorite: true,
    });
    expect(r.items[1]!.folders).toEqual([]);
  });

  it("imports Instapaper", () => {
    const r = parseServiceCsv(
      "URL,Title,Selection,Folder,Timestamp\nhttps://c.dev/,Long read,quoted bit,Starred,1700000000\nhttps://d.dev/,Other,,Research,1700000000\n",
    );
    expect(r.format).toBe("instapaper");
    expect(r.items[0]).toMatchObject({ notes: "quoted bit", favorite: true, folders: [] });
    expect(r.items[1]!.folders).toEqual(["Research"]);
  });

  it("imports Tymo CSV and generic CSVs, rejects CSVs without URLs", () => {
    const t = parseServiceCsv(
      "title,url,type,domain,description,tags,collections,notes,created_at\nX,https://e.dev/,link,e.dev,,a b,Reading | Later,,2024-01-01T00:00:00.000Z\n",
    );
    expect(t.format).toBe("tymo-csv");
    expect(t.items[0]).toMatchObject({ tags: ["a", "b"], folders: ["Reading"] });
    const g = parseServiceCsv("Name,Link,Labels\nSite,https://f.dev/,one;two\n");
    expect(g.format).toBe("csv");
    expect(g.items[0]).toMatchObject({ title: "Site", tags: ["one", "two"] });
    expect(() => parseServiceCsv("a,b\n1,2\n")).toThrow(/no URL column/);
  });

  it("imports Pinboard JSON", () => {
    const r = parsePinboardJson([
      {
        href: "https://g.dev/",
        description: "G",
        extended: "notes",
        tags: "x y",
        time: "2020-01-01T00:00:00Z",
        toread: "yes",
      },
      { href: "ftp://nope" },
    ]);
    expect(r).toMatchObject({
      skipped: 1,
      items: [{ title: "G", notes: "notes", tags: ["x", "y"] }],
    });
    expect(parsePinboardJson({ saves: [] })).toBeNull();
  });
});
