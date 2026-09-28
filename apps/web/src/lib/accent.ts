/**
 * User-selectable accent colour. One hex value drives every accent token in both themes:
 *  - `accent`      fills: primary buttons, active indicators, selection borders
 *  - `accent-ink`  accent-coloured *text* (links, counts), darkened in the light theme until it
 *                  reads on white, so a bright pick like lime never turns buttons olive
 *  - `on-accent`   text on an accent fill, black or white by contrast
 * Pure functions: used by the root layout (server render, no flash) and the settings picker.
 */

export const ACCENT_COOKIE = "tymo_accent";
export const DEFAULT_ACCENT = "#e5e5e6";

export const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: "Mono", hex: "#e5e5e6" },
  { name: "Lime", hex: "#e4f222" },
  { name: "Blue", hex: "#6798ff" },
  { name: "Violet", hex: "#8b7cf6" },
  { name: "Teal", hex: "#22c5d8" },
  { name: "Green", hex: "#4cc38a" },
  { name: "Orange", hex: "#f5a524" },
  { name: "Pink", hex: "#f06595" },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** A safe, normalised hex colour, or null. Only this value is ever written into CSS. */
export function parseAccent(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase();
  return v && HEX.test(v) ? v : null;
}

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Darkens (towards black) or lightens (towards white) until `min` contrast with `bg`. */
function readableOn(hex: string, bg: string, min: number, towards: Rgb): string {
  let c = hex;
  for (let t = 0; t <= 1 && contrast(c, bg) < min; t += 0.04)
    c = toHex(mix(toRgb(hex), towards, t));
  return c;
}

export interface AccentTokens {
  accent: string;
  hover: string;
  onAccent: string;
  soft: string;
  ink: string;
}

const DARK_BG = "#08090a";
const LIGHT_BG = "#ffffff";

export function deriveAccent(hex: string): { dark: AccentTokens; light: AccentTokens } {
  const rgb = toRgb(hex);
  const onAccent = contrast(hex, "#08090a") >= contrast(hex, "#ffffff") ? "#08090a" : "#ffffff";
  const soft = (a: number) => `rgb(${rgb.join(" ")} / ${a})`;
  const dark: AccentTokens = {
    accent: hex,
    hover: toHex(mix(rgb, onAccent === "#08090a" ? [255, 255, 255] : [0, 0, 0], 0.18)),
    onAccent,
    soft: soft(0.1),
    ink: readableOn(hex, DARK_BG, 4.5, [255, 255, 255]),
  };
  // A near-white pick ("Mono") would vanish on a white page: invert it to near-black there.
  const light: AccentTokens =
    luminance(hex) > 0.7 && Math.max(...rgb) - Math.min(...rgb) < 40
      ? {
          accent: "#1c1d1f",
          hover: "#34363a",
          onAccent: "#ffffff",
          soft: "rgb(0 0 0 / 0.05)",
          ink: "#1c1d1f",
        }
      : {
          accent: hex,
          hover: toHex(mix(rgb, [0, 0, 0], 0.1)),
          onAccent,
          soft: soft(0.14),
          ink: readableOn(hex, LIGHT_BG, 4.5, [0, 0, 0]),
        };
  return { dark, light };
}

function block(t: AccentTokens) {
  return (
    `--color-accent:${t.accent};--color-accent-hover:${t.hover};--color-on-accent:${t.onAccent};` +
    `--color-accent-soft:${t.soft};--color-accent-ink:${t.ink};`
  );
}

/**
 * CSS for the chosen accent. `html:root` outranks the defaults in globals.css regardless of
 * stylesheet order. Contains no quotes or angle brackets, and the input is a validated hex.
 */
export function accentCss(raw: string | null | undefined): string {
  const hex = parseAccent(raw) ?? DEFAULT_ACCENT;
  const { dark, light } = deriveAccent(hex);
  return (
    `html:root{${block(dark)}}` +
    `html:root[data-theme=light]{${block(light)}}` +
    `@media (prefers-color-scheme: light){html:root:not([data-theme]){${block(light)}}}`
  );
}
