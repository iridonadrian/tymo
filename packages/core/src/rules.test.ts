import { describe, expect, it } from "vitest";
import { matchesRules, smartRules } from "./rules";

const rules = smartRules.parse({
  groups: [
    [{ field: "tag", op: "is", value: "cybersecurity" }],
    [{ field: "domain", op: "contains", value: "hacktricks.xyz" }],
    [
      { field: "domain", op: "contains", value: "github.com" },
      { field: "tag", op: "is", value: "security" },
    ],
  ],
});
const base = { title: "x", url: null, domain: null, type: "link", tags: [] as string[] };

describe("smart rules", () => {
  it("matches DNF groups", () => {
    expect(matchesRules({ ...base, tags: ["cybersecurity"] }, rules)).toBe(true);
    expect(matchesRules({ ...base, domain: "book.hacktricks.xyz" }, rules)).toBe(true);
    expect(matchesRules({ ...base, domain: "github.com", tags: ["security"] }, rules)).toBe(true);
    expect(matchesRules({ ...base, domain: "github.com" }, rules)).toBe(false);
    expect(matchesRules(base, rules)).toBe(false);
  });
  it("rejects empty rules", () => {
    expect(smartRules.safeParse({ groups: [] }).success).toBe(false);
  });
});
