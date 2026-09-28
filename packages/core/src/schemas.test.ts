import { describe, expect, it } from "vitest";
import { createSaveInput, normalizeTag } from "./schemas";

describe("schemas", () => {
  it("normalizes tags", () => {
    expect(normalizeTag("#Incident Response")).toBe("incident-response");
    expect(normalizeTag("  C++ ")).toBe("c++");
    expect(normalizeTag("<script>")).toBe("script");
    expect(normalizeTag("###")).toBe("");
  });
  it("rejects javascript: urls", () => {
    expect(createSaveInput.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(createSaveInput.safeParse({ url: "https://a.com" }).success).toBe(true);
    expect(createSaveInput.safeParse({}).success).toBe(false);
  });
  it("dedupes tags", () => {
    const r = createSaveInput.parse({ url: "https://a.com", tags: ["AI", "#ai", "ml"] });
    expect(r.tags).toEqual(["ai", "ml"]);
  });
});
