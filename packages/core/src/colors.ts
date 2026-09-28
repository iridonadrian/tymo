/**
 * Colour search: dominant colours of an image and human colour names.
 *
 * Pure functions over raw RGBA pixels, so the same code runs wherever the pixels come from
 * (the browser decodes images for free; the server has no image decoder dependency).
 */

export const COLOR_NAMES = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "brown",
  "black",
  "gray",
  "white",
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

/** Representative swatch per name, used for chips and colour pickers. */
export const COLOR_SWATCHES: Record<ColorName, string> = {
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#f5d90a",
  green: "#46a758",
  teal: "#12a594",
  blue: "#3e63dd",
  purple: "#8e4ec6",
  pink: "#d6409f",
  brown: "#a07553",
  black: "#111111",
  gray: "#8b8d98",
  white: "#f5f5f5",
};

const ALIASES: Record<string, ColorName> = {
  grey: "gray",
  silver: "gray",
  violet: "purple",
  lavender: "purple",
  magenta: "pink",
  rose: "pink",
  cyan: "teal",
  turquoise: "teal",
  navy: "blue",
  beige: "brown",
  tan: "brown",
  gold: "yellow",
  crimson: "red",
  maroon: "red",
  olive: "green",
  lime: "green",
  mint: "green",
  cream: "white",
};

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function parseHex(v: string): [number, number, number] | null {
  const m = HEX.exec(v.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((c) =>
        Math.max(0, Math.min(255, Math.round(c)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

/** The everyday name of a colour ("#1e90ff" → "blue"). */
export function colorName(hexOrRgb: string | [number, number, number]): ColorName {
  const rgb = typeof hexOrRgb === "string" ? (parseHex(hexOrRgb) ?? [0, 0, 0]) : hexOrRgb;
  const [h, s, l] = hsl(...rgb);
  if (l < 0.12) return "black";
  if (l > 0.93 && s < 0.5) return "white";
  if (s < 0.14 || (s < 0.22 && (l < 0.25 || l > 0.8))) {
    return l > 0.82 ? "white" : l < 0.18 ? "black" : "gray";
  }
  // Browns are dark or muted oranges/yellows.
  if (h >= 15 && h < 50 && (l < 0.42 || s < 0.45)) return "brown";
  if (h < 12 || h >= 345) return l > 0.72 ? "pink" : "red";
  if (h < 40) return "orange";
  if (h < 66) return "yellow";
  if (h < 160) return "green";
  if (h < 190) return "teal";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return "pink";
}

/** A plain word that names a colour ("red", "grey", "navy"); never a hex code. */
export function colorWord(v: string): ColorName | null {
  const s = v.trim().toLowerCase();
  if ((COLOR_NAMES as readonly string[]).includes(s)) return s as ColorName;
  return ALIASES[s] ?? null;
}

/** A colour search term → colour name: "red", "grey", "#ff6600", "ff6600". */
export function parseColorQuery(v: string): ColorName | null {
  const s = v.trim().toLowerCase();
  if ((COLOR_NAMES as readonly string[]).includes(s)) return s as ColorName;
  if (ALIASES[s]) return ALIASES[s];
  const rgb = parseHex(s);
  return rgb ? colorName(rgb) : null;
}

export interface PaletteColor {
  hex: string;
  /** Fraction of the (opaque) image covered by this colour, 0–1. */
  share: number;
}

/**
 * Dominant colours from RGBA pixels (e.g. a canvas downscaled to ~48×48).
 * Buckets pixels in a coarse RGB grid, then merges buckets closer than `minDistance`.
 */
export function paletteFromPixels(
  rgba: ArrayLike<number>,
  { max = 5, minDistance = 48 }: { max?: number; minDistance?: number } = {},
): PaletteColor[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let total = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3]!;
    if (a < 128) continue;
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key);
    if (e) {
      e.r += r;
      e.g += g;
      e.b += b;
      e.n++;
    } else buckets.set(key, { r, g, b, n: 1 });
    total++;
  }
  if (!total) return [];
  const sorted = [...buckets.values()]
    .map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, n: e.n }))
    .sort((a, b) => b.n - a.n);
  const picked: { r: number; g: number; b: number; n: number }[] = [];
  for (const c of sorted) {
    const near = picked.find((p) => Math.hypot(p.r - c.r, p.g - c.g, p.b - c.b) < minDistance);
    if (near) {
      // Weighted merge keeps the swatch representative of the whole cluster.
      const n = near.n + c.n;
      near.r = (near.r * near.n + c.r * c.n) / n;
      near.g = (near.g * near.n + c.g * c.n) / n;
      near.b = (near.b * near.n + c.b * c.n) / n;
      near.n = n;
    } else if (picked.length < max * 3) picked.push({ ...c });
  }
  return picked
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .filter((c) => c.n / total >= 0.02)
    .map((c) => ({ hex: toHex(c.r, c.g, c.b), share: Math.round((c.n / total) * 1000) / 1000 }));
}

/** Names worth searching by: colours covering at least `minShare` of the image. */
export function paletteNames(palette: PaletteColor[], minShare = 0.08): ColorName[] {
  const names = new Set<ColorName>();
  for (const c of palette) if (c.share >= minShare) names.add(colorName(c.hex));
  return [...names];
}
