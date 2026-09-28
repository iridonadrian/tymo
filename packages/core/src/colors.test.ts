import { describe, expect, it } from "vitest";
import { colorName, paletteFromPixels, paletteNames, parseColorQuery } from "./colors";

function pixels(...parts: [rgb: [number, number, number], count: number, alpha?: number][]) {
  const out: number[] = [];
  for (const [[r, g, b], n, a = 255] of parts) for (let i = 0; i < n; i++) out.push(r, g, b, a);
  return out;
}

describe("colorName", () => {
  it.each([
    ["#e5484d", "red"],
    ["#ff0000", "red"],
    ["#ff8c00", "orange"],
    ["#ffd700", "yellow"],
    ["#228b22", "green"],
    ["#20b2aa", "teal"],
    ["#1e90ff", "blue"],
    ["#000080", "blue"],
    ["#8a2be2", "purple"],
    ["#ff69b4", "pink"],
    ["#8b4513", "brown"],
    ["#d2b48c", "brown"],
    ["#050505", "black"],
    ["#808080", "gray"],
    ["#fafafa", "white"],
    ["#ffb6c1", "pink"],
  ])("%s → %s", (hex, name) => {
    expect(colorName(hex)).toBe(name);
  });
});

describe("parseColorQuery", () => {
  it("accepts names, aliases and hex codes", () => {
    expect(parseColorQuery("Red")).toBe("red");
    expect(parseColorQuery("grey")).toBe("gray");
    expect(parseColorQuery("navy")).toBe("blue");
    expect(parseColorQuery("#ff6600")).toBe("orange");
    expect(parseColorQuery("06f")).toBe("blue");
    expect(parseColorQuery("chair")).toBeNull();
  });
});

describe("paletteFromPixels", () => {
  it("returns dominant colours by share, merging near-identical shades", () => {
    const p = paletteFromPixels(
      pixels([[250, 20, 20], 600], [[245, 30, 25], 100], [[20, 40, 200], 250], [[0, 0, 0], 50, 0]),
    );
    expect(p.map((c) => colorName(c.hex))).toEqual(["red", "blue"]);
    expect(p[0]!.share).toBeCloseTo(700 / 950, 2);
    expect(paletteNames(p)).toEqual(["red", "blue"]);
  });

  it("ignores transparent pixels and tiny specks", () => {
    expect(paletteFromPixels(pixels([[255, 0, 0], 10, 0]))).toEqual([]);
    const p = paletteFromPixels(pixels([[255, 255, 255], 990], [[255, 0, 0], 10]));
    expect(p.map((c) => colorName(c.hex))).toEqual(["white"]);
  });

  it("caps the number of colours", () => {
    const parts: [[number, number, number], number][] = [];
    for (let i = 0; i < 10; i++) parts.push([[i * 25, 255 - i * 25, (i * 70) % 255], 50]);
    expect(paletteFromPixels(pixels(...parts), { max: 4 }).length).toBeLessThanOrEqual(4);
  });
});
