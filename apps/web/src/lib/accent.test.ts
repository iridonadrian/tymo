import { describe, expect, it } from "vitest";
import { accentCss, contrast, deriveAccent, parseAccent } from "./accent";

describe("accent", () => {
  it("only accepts 6-digit hex colours", () => {
    expect(parseAccent(" #E4F222 ")).toBe("#e4f222");
    for (const bad of ["red", "#fff", "#e4f22", "#e4f222;}body{", "url(x)", "", null])
      expect(parseAccent(bad as string)).toBeNull();
  });

  it("keeps bright fills and derives readable ink for light mode", () => {
    const lime = deriveAccent("#e4f222");
    expect(lime.light.accent).toBe("#e4f222"); // buttons stay lime, no olive fill
    expect(lime.light.onAccent).toBe("#08090a");
    expect(contrast(lime.light.ink, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(lime.dark.ink).toBe("#e4f222");
    const violet = deriveAccent("#5b21b6");
    expect(violet.dark.onAccent).toBe("#ffffff");
    // Mono inverts to near-black on white pages.
    expect(deriveAccent("#e5e5e6").light).toMatchObject({ accent: "#1c1d1f", onAccent: "#ffffff" });
    expect(contrast(violet.dark.ink, "#08090a")).toBeGreaterThanOrEqual(4.5);
  });

  it("emits CSS with no injectable characters and falls back to the default", () => {
    const css = accentCss("#6798ff");
    expect(css).toContain("--color-accent:#6798ff;");
    expect(css).not.toMatch(/["'<>]/);
    expect(accentCss("javascript:alert(1)")).toContain("--color-accent:#e5e5e6;");
  });
});
