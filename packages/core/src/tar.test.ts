import { describe, expect, it } from "vitest";
import { isSafeTarName, parseTarHeader, tarHeader, tarPadding, TAR_BLOCK } from "./tar";

describe("tar", () => {
  it("round-trips headers", () => {
    const h = tarHeader("files/0190-abc", 1234, 1_700_000_000_000);
    expect(h.length).toBe(TAR_BLOCK);
    expect(parseTarHeader(h)).toEqual({ name: "files/0190-abc", size: 1234, type: "0" });
    expect(parseTarHeader(new Uint8Array(TAR_BLOCK))).toBe("end");
  });

  it("rejects tampering and unsafe names", () => {
    const h = tarHeader("tymo.db", 10);
    h[0] = "x".charCodeAt(0);
    expect(() => parseTarHeader(h)).toThrow(/checksum/);
    for (const bad of ["../etc/passwd", "/abs", "a/b/c", "files/..", "", "a\\b", "x".repeat(100)])
      expect(isSafeTarName(bad)).toBe(false);
    expect(() => tarHeader("../x", 1)).toThrow();
  });

  it("pads to whole blocks", () => {
    expect(tarPadding(0)).toBe(0);
    expect(tarPadding(1)).toBe(511);
    expect(tarPadding(512)).toBe(0);
  });
});
