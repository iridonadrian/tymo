import { describe, expect, it } from "vitest";
import { detectType, repoInfo } from "./detect";

describe("detectType", () => {
  it.each([
    ["https://github.com/projectdiscovery/nuclei", "repo"],
    ["https://github.com/topics/osint", "link"],
    ["https://www.youtube.com/watch?v=abc", "video"],
    ["https://youtu.be/abc", "video"],
    ["https://x.com/someone/status/1", "social"],
    ["https://old.reddit.com/r/netsec", "social"],
    ["https://example.com/paper.pdf", "pdf"],
    ["https://example.com/pic.PNG", "image"],
    ["https://maps.google.com/?q=x", "place"],
    ["https://www.google.com/maps/place/Burj", "place"],
    ["https://www.imdb.com/title/tt0133093/", "movie"],
    ["https://example.com/", "link"],
  ])("%s → %s", (url, type) => expect(detectType(url)).toBe(type));

  it("uses hints", () => {
    expect(detectType("https://blog.example.com/x", { ogType: "article" })).toBe("article");
    expect(detectType("https://food.example.com/x", { jsonLdTypes: ["Recipe"] })).toBe("recipe");
    expect(detectType("https://cdn.example.com/x", { contentType: "application/pdf" })).toBe("pdf");
    expect(detectType(null)).toBe("note");
  });

  it("repoInfo", () => {
    expect(repoInfo("https://github.com/a/b.git")).toEqual({ owner: "a", repo: "b" });
    expect(repoInfo("https://example.com/a/b")).toBeNull();
  });
});
