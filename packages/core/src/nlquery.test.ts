import { describe, expect, it } from "vitest";
import { interpretQuery, looksNatural } from "./nlquery";
import { parseQuery } from "./query";

// Friday 2026-09-25, 15:00 UTC
const NOW = Date.UTC(2026, 8, 25, 15);
const q = (s: string) => interpretQuery(s, NOW);

describe("looksNatural", () => {
  it("leaves keyword searches and operator syntax alone", () => {
    expect(looksNatural("react")).toBe(false);
    expect(looksNatural("react hooks")).toBe(false);
    expect(looksNatural("tag:ai react from last week")).toBe(false);
    expect(looksNatural('"exact phrase" here and there')).toBe(false);
    expect(looksNatural("#dfir notes about things")).toBe(false);
  });
  it("recognises sentences, time phrases and plural types", () => {
    expect(looksNatural("articles about react")).toBe(true);
    expect(looksNatural("react yesterday")).toBe(true);
    expect(looksNatural("recipes")).toBe(true);
    expect(looksNatural("recipe")).toBe(false);
  });
});

describe("interpretQuery", () => {
  it("keeps keyword searches unchanged", () => {
    expect(q("react hooks")).toEqual({ query: "react hooks", changed: false });
  });

  it("types, topics and relative weeks", () => {
    // Last week = Mon 2026-09-14 … Sun 2026-09-20.
    expect(q("articles about react from last week").query).toBe(
      "after:2026-09-13 before:2026-09-21 type:article react",
    );
    expect(q("videos on youtube I haven't watched").query).toBe(
      "is:unread domain:youtube.com type:video",
    );
  });

  it("days, months, years and 'ago'", () => {
    expect(q("notes from yesterday").query).toBe("after:2026-09-23 before:2026-09-25 type:note");
    expect(q("stuff I saved today").query).toBe("after:2026-09-24 before:2026-09-26");
    expect(q("recipes from the last 3 days").query).toBe(
      "after:2026-09-21 before:2026-09-26 type:recipe",
    );
    expect(q("repos in march").query).toBe("after:2026-02-28 before:2026-04-01 type:repo");
    expect(q("books from november").query).toBe("after:2025-10-31 before:2025-12-01 type:book");
    expect(q("blue photos from the last month").query).toBe(
      "after:2026-08-25 before:2026-09-26 type:image blue",
    );
    expect(q("pdfs in 2025").query).toBe("after:2024-12-31 before:2026-01-01 type:pdf");
    expect(q("that article about rust 2 weeks ago").query).toBe(
      "after:2026-09-06 before:2026-09-16 type:article rust",
    );
  });

  it("does not read the word 'may' as a month", () => {
    expect(q("tools that may help with diffing").query).toBe("type:tool may help diffing");
    expect(q("a tool for diffing json files").query).toBe("type:tool diffing json file");
  });

  it("flags, sites and tags", () => {
    expect(q("my favorite recipes").query).toBe("is:fav type:recipe");
    expect(q("posts from hacker news in my inbox").query).toBe(
      "in:inbox domain:news.ycombinator.com type:social",
    );
    expect(q("anything from nytimes.com tagged politics").query).toBe(
      "tag:politics domain:nytimes.com anything",
    );
    expect(q("dead links in the archive").query).toBe("in:archive is:broken");
  });

  it("keeps colour words as soft text for the parser", () => {
    const r = q("red chair photos");
    expect(r.query).toBe("type:image red chair");
    const parsed = parseQuery(r.query);
    expect(parsed.softColors).toEqual([{ color: "red", word: "red" }]);
    expect(parsed.terms).toEqual(["chair"]);
    expect(parsed.types).toEqual(["image"]);
  });

  it("produces queries the parser understands", () => {
    const p = parseQuery(q("unread articles from github this month").query);
    expect(p).toMatchObject({
      unread: true,
      types: ["article"],
      domains: ["github.com"],
      after: Date.parse("2026-08-31T23:59:59.999Z"),
    });
  });
});
