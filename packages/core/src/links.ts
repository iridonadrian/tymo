/**
 * Links pasted from a browser: Safari's "Copy Links" (one URL per line), Dia/Chrome/Arc tab
 * copies ("Title\nURL" or "Title - URL"), Markdown lists ("[Title](URL)"), or any text with
 * URLs in it. Pure; returns unique http(s) links in order, with a title when one is given.
 */
import { isHttpUrl } from "./url";

export interface PastedLink {
  url: string;
  title?: string;
}

export const MAX_PASTED_LINKS = 500;

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const MD_RE = /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]+)\)/gi;

/** URLs pasted from prose often drag punctuation along: "(see https://x.com/a)." */
function trimUrl(u: string): string {
  let url = u.replace(/[.,;:!?'"»”’]+$/, "");
  // Keep balanced parentheses (Wikipedia-style URLs), drop a stray closing one.
  while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0))
    url = url.slice(0, -1).replace(/[.,;:!?]+$/, "");
  return url;
}

function cleanTitle(t: string | undefined): string | undefined {
  const v = t
    ?.replace(/^[\s\-–—•*·|:>#\d.)]+/, "")
    .replace(/[\s\-–—|:·]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return v && v.length <= 300 && !isHttpUrl(v) ? v : undefined;
}

export function parsePastedLinks(text: string): PastedLink[] {
  const out = new Map<string, PastedLink>();
  const add = (rawUrl: string, title?: string) => {
    if (out.size >= MAX_PASTED_LINKS) return;
    const url = trimUrl(rawUrl);
    if (!isHttpUrl(url)) return;
    const prev = out.get(url);
    if (!prev) out.set(url, { url, ...(title ? { title } : {}) });
    else if (!prev.title && title) prev.title = title;
  };

  const lines = text.slice(0, 1_000_000).split(/\r?\n/);
  let pendingTitle: string | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      pendingTitle = undefined;
      continue;
    }
    const md = [...trimmed.matchAll(MD_RE)];
    if (md.length) {
      for (const m of md) add(m[2]!, cleanTitle(m[1]));
      pendingTitle = undefined;
      continue;
    }
    const urls = [...trimmed.matchAll(URL_RE)].map((m) => ({ url: m[0], at: m.index ?? 0 }));
    if (!urls.length) {
      // A line of text right before a URL line is that URL's title (tab copies).
      pendingTitle = cleanTitle(trimmed);
      continue;
    }
    if (urls.length === 1) {
      const before = cleanTitle(trimmed.slice(0, urls[0]!.at));
      const after = cleanTitle(trimmed.slice(urls[0]!.at + urls[0]!.url.length));
      add(urls[0]!.url, before ?? after ?? pendingTitle);
    } else {
      for (const u of urls) add(u.url);
    }
    pendingTitle = undefined;
  }
  return [...out.values()];
}
