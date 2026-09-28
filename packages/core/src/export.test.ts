import { describe, expect, it } from "vitest";
import { csvCell, toCsv, toMarkdown } from "./export";

describe("csv", () => {
  it("escapes formula injection and quotes", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
  });
  it("renders rows", () => {
    const csv = toCsv([
      { title: "T", url: "https://a.com", tags: ["x", "y"], collections: [], createdAt: 0 },
    ]);
    expect(csv.split("\r\n")[1]).toBe("T,https://a.com,,,,x y,,,1970-01-01T00:00:00.000Z");
  });
});

describe("markdown", () => {
  it("escapes titles", () => {
    const md = toMarkdown([
      {
        title: "[x](javascript:1)",
        url: "https://a.com/(x)",
        tags: ["t"],
        collections: [],
        createdAt: 0,
      },
    ]);
    expect(md).toContain("- [\\[x\\](javascript:1)](https://a.com/%28x%29) `#t`");
  });
});
