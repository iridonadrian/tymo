import { describe, expect, it } from "vitest";
import { parsePastedLinks } from "./links";

describe("parsePastedLinks", () => {
  it("reads Safari's Copy Links (one URL per line)", () => {
    expect(
      parsePastedLinks(
        "https://a.example/one\nhttps://b.example/two?x=1\n\nhttps://a.example/one\n",
      ),
    ).toEqual([{ url: "https://a.example/one" }, { url: "https://b.example/two?x=1" }]);
  });

  it("pairs a title line with the URL on the next line", () => {
    expect(
      parsePastedLinks("Linear – Plan and build\nhttps://linear.app/\nFigma\nhttps://figma.com/"),
    ).toEqual([
      { url: "https://linear.app/", title: "Linear – Plan and build" },
      { url: "https://figma.com/", title: "Figma" },
    ]);
  });

  it("reads 'Title - URL' lines, Markdown links and bullet lists", () => {
    expect(
      parsePastedLinks(
        [
          "- Hacker News - https://news.ycombinator.com/",
          "* [Tailwind docs](https://tailwindcss.com/docs)",
          "1. https://sqlite.org/fts5.html | SQLite FTS5",
        ].join("\n"),
      ),
    ).toEqual([
      { url: "https://news.ycombinator.com/", title: "Hacker News" },
      { url: "https://tailwindcss.com/docs", title: "Tailwind docs" },
      { url: "https://sqlite.org/fts5.html", title: "SQLite FTS5" },
    ]);
  });

  it("finds URLs in prose and trims trailing punctuation", () => {
    expect(
      parsePastedLinks(
        "See (https://en.wikipedia.org/wiki/Tab_(interface)) and https://x.example/a, then https://y.example/b.",
      ).map((l) => l.url),
    ).toEqual([
      "https://en.wikipedia.org/wiki/Tab_(interface)",
      "https://x.example/a",
      "https://y.example/b",
    ]);
  });

  it("ignores non-http links and junk", () => {
    expect(parsePastedLinks("javascript:alert(1)\nfile:///etc/passwd\nhello world")).toEqual([]);
  });
});
