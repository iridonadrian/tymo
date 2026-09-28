import { describe, expect, it } from "vitest";
import { parseQuery, toFtsMatch } from "./query";

describe("parseQuery", () => {
  it("parses operators", () => {
    const q = parseQuery(
      'osint tools tag:DFIR #ai domain:www.github.com type:github is:fav in:inbox collection:"AI Tools" -spam "exact phrase" after:2026-01-01',
    );
    expect(q.terms).toEqual(["osint", "tools"]);
    expect(q.tags).toEqual(["dfir", "ai"]);
    expect(q.domains).toEqual(["github.com"]);
    expect(q.types).toEqual(["repo"]);
    expect(q.favorite).toBe(true);
    expect(q.inbox).toBe(true);
    expect(q.collections).toEqual(["AI Tools"]);
    expect(q.excluded).toEqual(["spam"]);
    expect(q.phrases).toEqual(["exact phrase"]);
    expect(q.after).toBe(Date.UTC(2026, 0, 1) + 86_400_000 - 1);
  });
  it("keeps unknown keys as text", () => {
    expect(parseQuery("https://x.com").terms).toEqual(["https://x.com"]);
  });
});

describe("toFtsMatch", () => {
  it("quotes everything so FTS syntax is inert", () => {
    expect(toFtsMatch(parseQuery("foo OR bar NEAR(x) title:y"))).toBe(
      '"foo"* AND "OR"* AND "bar"* AND "NEAR"* AND "x"* AND "title"* AND "y"*',
    );
    expect(toFtsMatch(parseQuery('a"b'))).toBe('"a"* AND "b"*');
    expect(toFtsMatch(parseQuery('"incident response" -phishing'))).toBe(
      '("incident response") NOT ("phishing")',
    );
    expect(toFtsMatch(parseQuery("tag:x"))).toBeNull();
  });
});
