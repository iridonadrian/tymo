import { ACCENT_COOKIE, accentCss, parseAccent } from "./accent";

export type ThemePref = "system" | "light" | "dark";

/** Applies a theme preference immediately and remembers it in a cookie the server reads. */
export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  document.cookie = `tymo_theme=${pref}; path=/; max-age=31536000; samesite=lax`;
}

export function effectiveTheme(): "light" | "dark" {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Applies an accent colour immediately and remembers it (null = default). */
export function applyAccent(hex: string | null) {
  const value = parseAccent(hex);
  const el = document.getElementById("tymo-accent");
  if (el) el.textContent = accentCss(value);
  document.cookie = value
    ? `${ACCENT_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`
    : `${ACCENT_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
