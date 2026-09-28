/**
 * Netscape bookmark file format (exported by Chrome, Edge, Brave, Firefox, Safari, Pinboard…).
 */
import { Parser } from "htmlparser2";
import { isHttpUrl } from "./url";

export interface ImportedBookmark {
  url: string;
  title: string;
  description?: string;
  addDate?: number; // unix ms
  folders: string[];
  tags: string[];
}

/** Browser container folders that shouldn't become collections. */
const ROOT_FOLDERS = new Set(
  [
    "bookmarks bar",
    "bookmarks toolbar",
    "bookmarks menu",
    "other bookmarks",
    "mobile bookmarks",
    "favorites bar",
    "favourites bar",
    "favorites",
    "bookmarks",
    "toolbar",
    "menu",
    "unfiled",
  ].map((s) => s.toLowerCase()),
);

export const MAX_IMPORT_ITEMS = 50_000;

function parseAddDate(raw: string | undefined): number | undefined {
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  // Seconds (Netscape) vs. microseconds (some exporters) vs. ms.
  const ms = n > 1e14 ? Math.floor(n / 1000) : n > 1e11 ? n : n * 1000;
  return ms > 0 && ms < 4102444800000 ? ms : undefined;
}

export function parseNetscapeBookmarks(html: string): {
  items: ImportedBookmark[];
  skipped: number;
} {
  const items: ImportedBookmark[] = [];
  let skipped = 0;
  const stack: (string | null)[] = [];
  let pendingFolder: string | null = null;
  let inH3 = false;
  let h3Text = "";
  let current: (ImportedBookmark & { _text: string }) | null = null;
  let last: ImportedBookmark | null = null;
  let inDD = false;
  let ddText = "";

  const finishAnchor = () => {
    if (!current) return;
    const { _text, ...rest } = current;
    rest.title = _text.replace(/\s+/g, " ").trim().slice(0, 500) || rest.url;
    if (items.length < MAX_IMPORT_ITEMS) {
      items.push(rest);
      last = rest;
    } else skipped++;
    current = null;
  };
  const finishDD = () => {
    if (inDD && last) {
      const d = ddText.replace(/\s+/g, " ").trim().slice(0, 2000);
      if (d) last.description = d;
    }
    inDD = false;
    ddText = "";
  };

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === "h3") {
          finishDD();
          inH3 = true;
          h3Text = "";
        } else if (name === "dl") {
          finishDD();
          stack.push(pendingFolder);
          pendingFolder = null;
        } else if (name === "a") {
          finishDD();
          const href = (attrs.href ?? "").trim();
          if (!isHttpUrl(href)) {
            skipped++;
            return;
          }
          const folders = stack.filter((f): f is string => !!f);
          current = {
            url: href,
            title: "",
            _text: "",
            addDate: parseAddDate(attrs.add_date),
            folders,
            tags: (attrs.tags ?? "")
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, 50),
          };
        } else if (name === "dd") {
          finishDD();
          inDD = true;
        } else if (name === "dt") {
          finishDD();
        }
      },
      ontext(text) {
        if (inH3) h3Text += text;
        else if (current) current._text += text;
        else if (inDD) ddText += text;
      },
      onclosetag(name) {
        if (name === "h3") {
          inH3 = false;
          const folder = h3Text.replace(/\s+/g, " ").trim().slice(0, 80);
          pendingFolder =
            folder && !(stack.length <= 1 && ROOT_FOLDERS.has(folder.toLowerCase()))
              ? folder
              : null;
        } else if (name === "a") {
          finishAnchor();
        } else if (name === "dl") {
          finishDD();
          stack.pop();
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();
  finishDD();
  return { items, skipped };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export interface ExportableSave {
  url: string | null;
  title: string;
  description?: string | null;
  notes?: string | null;
  tags: string[];
  collections: string[];
  createdAt: number;
  type?: string;
  domain?: string | null;
}

/** Exports saves as a Netscape bookmark file, grouped by first collection. */
export function toNetscapeBookmarks(saves: ExportableSave[]): string {
  const groups = new Map<string, ExportableSave[]>();
  for (const s of saves) {
    if (!s.url || !isHttpUrl(s.url)) continue;
    const key = s.collections[0] ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const line = (s: ExportableSave, indent: string) => {
    const tags = s.tags.length ? ` TAGS="${escapeHtml(s.tags.join(","))}"` : "";
    let out = `${indent}<DT><A HREF="${escapeHtml(s.url!)}" ADD_DATE="${Math.floor(s.createdAt / 1000)}"${tags}>${escapeHtml(s.title)}</A>\n`;
    if (s.description) out += `${indent}<DD>${escapeHtml(s.description)}\n`;
    return out;
  };
  let out =
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n" +
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
    "<TITLE>Bookmarks</TITLE>\n<H1>Tymo export</H1>\n<DL><p>\n";
  for (const [name, list] of groups) {
    if (!name) {
      for (const s of list) out += line(s, "    ");
      continue;
    }
    out += `    <DT><H3>${escapeHtml(name)}</H3>\n    <DL><p>\n`;
    for (const s of list) out += line(s, "        ");
    out += "    </DL><p>\n";
  }
  return out + "</DL><p>\n";
}
