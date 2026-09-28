import { describe, expect, it } from "vitest";
import { highlightRanges, quoteTitle, textFragmentUrl } from "./highlights";

describe("quoteTitle", () => {
  it("uses the first words", () => {
    expect(quoteTitle("  The best  search index is the one you do not have to operate. ")).toBe(
      "The best search index is the one you do not have to…",
    );
    expect(quoteTitle("Short one")).toBe("Short one");
    expect(quoteTitle("   ")).toBe("Highlight");
  });
});

describe("textFragmentUrl", () => {
  it("links to short passages directly and long ones by start and end", () => {
    expect(textFragmentUrl("https://ex.com/a?x=1#old", "Hello, world - it’s me")).toBe(
      "https://ex.com/a?x=1#:~:text=Hello%2C%20world%20%2D%20it%27s%20me",
    );
    const long = "one two three four five six seven eight nine ten eleven twelve";
    expect(textFragmentUrl("https://ex.com/", long)).toBe(
      "https://ex.com/#:~:text=one%20two%20three%20four%20five,eight%20nine%20ten%20eleven%20twelve",
    );
  });
});

describe("highlightRanges", () => {
  const text = "Most apps need search.\nSQLite ships a very capable  full-text engine called FTS5.";
  it("finds passages with loose whitespace and curly quotes", () => {
    const r = highlightRanges(text, ["SQLite ships a very capable full-text engine"]);
    expect(r).toHaveLength(1);
    expect(text.slice(...r[0]!)).toBe("SQLite ships a very capable  full-text engine");
    const curly = highlightRanges("He said “it’s fine” twice today", ['said "it\'s fine" twice']);
    expect(curly).toEqual([[3, 25]]);
  });
  it("matches multi-paragraph quotes piece by piece and merges overlaps", () => {
    const r = highlightRanges(text, [
      "apps need search.\nSQLite ships a very",
      "need search. SQLite",
    ]);
    expect(r.map((x) => text.slice(...x))).toEqual(["apps need search.\nSQLite ships a very"]);
  });
  it("ignores very short fragments and missing text", () => {
    expect(highlightRanges(text, ["FTS5", "not in the text at all"])).toEqual([]);
    expect(highlightRanges("FTS5", ["FTS5"])).toEqual([[0, 4]]);
  });
});
