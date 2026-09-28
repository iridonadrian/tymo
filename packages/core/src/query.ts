/**
 * Search query language.
 *   free text            → full-text (prefix-matched)
 *   "exact phrase"       → phrase
 *   -word                → exclude
 *   tag:osint  #osint    → tag filter (repeatable, AND)
 *   domain:github.com    → domain contains
 *   type:repo            → content type
 *   collection:"AI Tools"→ collection name
 *   in:inbox | in:archive
 *   is:fav | is:archived | is:unread | is:snoozed | is:broken | is:bookmark
 *   before:2026-01-01  after:2026-01-01
 *   color:red  color:#ff6600  → dominant image colour
 */
import { colorWord, parseColorQuery, type ColorName } from "./colors";
import { SAVE_TYPES, normalizeTag, type SaveType } from "./schemas";

export interface ParsedQuery {
  terms: string[];
  phrases: string[];
  excluded: string[];
  tags: string[];
  domains: string[];
  types: SaveType[];
  collections: string[];
  colors: ColorName[];
  /**
   * Colour words typed as plain text ("red chair"): they match either the image colour or
   * the word itself, so "red team" still finds articles about red teams.
   */
  softColors: { color: ColorName; word: string }[];
  inbox?: boolean;
  archived?: boolean;
  favorite?: boolean;
  unread?: boolean;
  snoozed?: boolean;
  broken?: boolean;
  bookmark?: boolean;
  before?: number;
  after?: number;
}

const TYPE_ALIASES: Record<string, SaveType> = {
  github: "repo",
  repository: "repo",
  post: "social",
  tweet: "social",
  screenshot: "screenshot",
  img: "image",
  doc: "document",
  app: "tool",
  film: "movie",
  show: "movie",
  url: "link",
  website: "link",
};

function parseDate(v: string, endOfDay: boolean): number | undefined {
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(v)) return undefined;
  const d = new Date(v.length === 7 ? `${v}-01T00:00:00Z` : `${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return endOfDay ? d.getTime() + 86_400_000 - 1 : d.getTime();
}

export function parseQuery(input: string): ParsedQuery {
  const q: ParsedQuery = {
    terms: [],
    phrases: [],
    excluded: [],
    tags: [],
    domains: [],
    types: [],
    collections: [],
    colors: [],
    softColors: [],
  };
  const re = /(-?)(?:(\w+):)?(?:"([^"]*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  const src = input.slice(0, 500);
  while ((m = re.exec(src))) {
    const neg = m[1] === "-";
    const key = m[2]?.toLowerCase();
    const quoted = m[3];
    const value = (quoted ?? m[4] ?? "").trim();
    if (!value) continue;

    if (key) {
      const v = value.toLowerCase();
      switch (key) {
        case "tag":
          if (normalizeTag(v)) q.tags.push(normalizeTag(v));
          continue;
        case "domain":
        case "site":
          q.domains.push(
            v
              .replace(/^https?:\/\//, "")
              .replace(/^www\./, "")
              .replace(/\/.*$/, ""),
          );
          continue;
        case "type": {
          const t = (TYPE_ALIASES[v] ?? v) as SaveType;
          if ((SAVE_TYPES as readonly string[]).includes(t)) q.types.push(t);
          continue;
        }
        case "collection":
        case "col":
          q.collections.push(value);
          continue;
        case "color":
        case "colour": {
          const c = parseColorQuery(v);
          if (c && !q.colors.includes(c)) q.colors.push(c);
          continue;
        }
        case "in":
          if (v === "inbox") q.inbox = true;
          else if (v === "archive" || v === "archived") q.archived = true;
          continue;
        case "is":
          if (["fav", "favorite", "favourite", "starred", "star"].includes(v)) q.favorite = true;
          else if (v === "archived") q.archived = true;
          else if (v === "unread") q.unread = true;
          else if (v === "snoozed") q.snoozed = true;
          else if (v === "broken" || v === "dead") q.broken = true;
          else if (v === "bookmark" || v === "bookmarked" || v === "bookmarks") q.bookmark = true;
          else if (v === "inbox") q.inbox = true;
          continue;
        case "before":
          q.before = parseDate(v, false) ?? q.before;
          continue;
        case "after":
          q.after = parseDate(v, true) ?? q.after;
          continue;
        // Unknown key: treat the whole token as text (e.g. "http://…", "c++:").
      }
      const whole = `${m[2]}:${value}`;
      (neg ? q.excluded : q.terms).push(whole);
      continue;
    }
    if (!quoted && value.startsWith("#") && value.length > 1) {
      const t = normalizeTag(value);
      if (t) q.tags.push(t);
      continue;
    }
    if (neg) q.excluded.push(value);
    else if (quoted) q.phrases.push(value);
    else if (colorWord(value)) q.softColors.push({ color: colorWord(value)!, word: value });
    else q.terms.push(value);
  }
  return q;
}

export function hasTextQuery(q: ParsedQuery): boolean {
  return q.terms.length > 0 || q.phrases.length > 0 || q.softColors.length > 0;
}

/** A single user word as a safe FTS5 prefix query (every token quoted). */
export function ftsWord(word: string): string | null {
  const toks = word
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean)
    .slice(0, 4);
  return toks.length ? toks.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" AND ") : null;
}

/**
 * Builds a safe FTS5 MATCH expression. Every user token is quoted, so FTS operators
 * (AND/OR/NEAR/column filters/parentheses) in user input are inert.
 */
export function toFtsMatch(q: ParsedQuery): string | null {
  const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"';
  const tokens = (s: string) =>
    s
      .split(/[^\p{L}\p{N}_]+/u)
      .filter(Boolean)
      .slice(0, 16);
  const parts: string[] = [];
  for (const t of q.terms) for (const tok of tokens(t)) parts.push(quote(tok) + "*");
  for (const p of q.phrases) {
    const toks = tokens(p);
    if (toks.length) parts.push(quote(toks.join(" ")));
  }
  if (!parts.length) return null;
  let expr = parts.join(" AND ");
  const neg = q.excluded.flatMap(tokens).map(quote);
  if (neg.length) expr = `(${expr}) NOT (${neg.join(" OR ")})`;
  return expr;
}
