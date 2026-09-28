/**
 * Reader view: pulls the main article out of an untrusted page and returns it as plain,
 * structured blocks (headings, paragraphs, lists, quotes, code, images, tables).
 *
 * The output is data, never HTML: the UI renders it with ordinary React elements, so nothing
 * from the page can execute or inject markup. Links are kept only when they resolve to an
 * absolute http(s) URL. Everything is length-capped.
 */
import { Parser } from "htmlparser2";
import { resolveHttpUrl } from "./url";

export interface Run {
  text: string;
  bold?: true;
  italic?: true;
  code?: true;
  href?: string;
}

export type Block =
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "paragraph"; runs: Run[] }
  | { type: "list"; ordered: boolean; items: Run[][] }
  | { type: "quote"; runs: Run[] }
  | { type: "code"; text: string; lang?: string }
  | { type: "image"; src: string; alt?: string; caption?: string }
  | { type: "table"; rows: string[][]; header: boolean }
  | { type: "rule" };

export interface ReaderContent {
  v: 1;
  blocks: Block[];
  words: number;
}

const MAX_BLOCKS = 600;
const MAX_CHARS = 150_000;
const MAX_IMAGES = 60;
const MAX_RUN_TEXT = 20_000;

/** Removed together with everything inside them. */
const DROP = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "math",
  "iframe",
  "frame",
  "object",
  "embed",
  "canvas",
  "video",
  "audio",
  "form",
  "button",
  "select",
  "input",
  "textarea",
  "nav",
  "footer",
  "aside",
  "header",
  "dialog",
  "head",
  "title",
  "link",
  "meta",
]);
const VOID = new Set(["area", "br", "col", "hr", "img", "source", "track", "wbr", "base", "param"]);
const BLOCKISH = new Set([
  "address",
  "article",
  "blockquote",
  "details",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "ul",
]);

const NEGATIVE =
  /(^|[-_\s])(comments?|sidebar|footer|nav|navbar|menu|share|sharing|social|related|recommended|promo|advert|ads?|sponsored|cookie|consent|newsletter|subscribe|signup|breadcrumbs?|popup|modal|masthead|toolbar|pagination|pager|byline-share|author-bio|skip-link|visually-hidden|sr-only|screen-reader-text)([-_\s]|$)/i;
const POSITIVE =
  /(^|[-_\s])(article|content|entry|main|story|prose|markdown|post-content|post-body|entry-content|article-body|body-text)([-_\s]|$)/i;

interface El {
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
  parent: El | null;
}
type Node = El | string;

function isHidden(attrs: Record<string, string>): boolean {
  if ("hidden" in attrs || attrs["aria-hidden"] === "true") return true;
  const style = (attrs.style ?? "").replace(/\s+/g, "").toLowerCase();
  return style.includes("display:none") || style.includes("visibility:hidden");
}

function isBoilerplate(tag: string, attrs: Record<string, string>): boolean {
  if (tag === "body" || tag === "html" || tag === "article" || tag === "main") return false;
  const sig = `${attrs.class ?? ""} ${attrs.id ?? ""} ${attrs.role ?? ""}`;
  if (/\b(navigation|banner|complementary|contentinfo|dialog|alert)\b/.test(attrs.role ?? ""))
    return true;
  return NEGATIVE.test(sig) && !POSITIVE.test(sig);
}

/** Parses into a small tree, dropping scripts, chrome and hidden or boilerplate elements. */
function parseTree(html: string): El {
  const root: El = { tag: "#root", attrs: {}, children: [], parent: null };
  let cur = root;
  let skip = 0;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (skip) {
          if (!VOID.has(name)) skip++;
          return;
        }
        if (DROP.has(name) || isHidden(attrs) || isBoilerplate(name, attrs)) {
          if (!VOID.has(name)) skip = 1;
          return;
        }
        const el: El = { tag: name, attrs, children: [], parent: cur };
        cur.children.push(el);
        if (!VOID.has(name)) cur = el;
      },
      ontext(text) {
        if (skip) return;
        const last = cur.children[cur.children.length - 1];
        if (typeof last === "string") cur.children[cur.children.length - 1] = last + text;
        else cur.children.push(text);
      },
      onclosetag(name) {
        if (skip) {
          if (!VOID.has(name)) skip--;
          return;
        }
        if (VOID.has(name)) return;
        // Close up to the matching element; ignore stray end tags.
        let el: El | null = cur;
        while (el && el.tag !== name) el = el.parent;
        if (el?.parent) cur = el.parent;
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();
  return root;
}

const textCache = new WeakMap<El, string>();
function textOf(n: Node): string {
  if (typeof n === "string") return n;
  let t = textCache.get(n);
  if (t === undefined) {
    t = n.children.map(textOf).join("");
    textCache.set(n, t);
  }
  return t;
}

const blockCache = new WeakMap<El, boolean>();
/** Whether an element contains block-level content or images (so it can't be one run). */
function hasBlockContent(el: El): boolean {
  let v = blockCache.get(el);
  if (v === undefined) {
    v = el.children.some(
      (c) =>
        typeof c !== "string" &&
        (BLOCKISH.has(c.tag) || c.tag === "img" || c.tag === "picture" || hasBlockContent(c)),
    );
    blockCache.set(el, v);
  }
  return v;
}

function linkTextOf(n: Node): number {
  if (typeof n === "string") return 0;
  if (n.tag === "a") return textOf(n).trim().length;
  return n.children.reduce((s, c) => s + linkTextOf(c), 0);
}

function* walk(el: El): Generator<El> {
  yield el;
  for (const c of el.children) if (typeof c !== "string") yield* walk(c);
}

/**
 * Finds the element holding the article: readability-style scoring of paragraph containers,
 * penalised by link density, preferring an enclosing <article> when it adds little else.
 */
function findContentRoot(root: El): El {
  const scores = new Map<El, number>();
  for (const el of walk(root)) {
    if (el.tag !== "p" && el.tag !== "pre" && el.tag !== "td" && el.tag !== "blockquote") continue;
    const text = textOf(el).replace(/\s+/g, " ").trim();
    if (text.length < 25) continue;
    const score = 1 + (text.match(/[,，、]/g)?.length ?? 0) + Math.min(text.length / 100, 3);
    const parent = el.parent;
    if (parent) scores.set(parent, (scores.get(parent) ?? 0) + score);
    const grand = parent?.parent;
    if (grand) scores.set(grand, (scores.get(grand) ?? 0) + score / 2);
  }
  let best: El | null = null;
  let bestScore = 0;
  for (const [el, raw] of scores) {
    const text = textOf(el).length || 1;
    const score = raw * (1 - Math.min(linkTextOf(el) / text, 1));
    if (score > bestScore) {
      best = el;
      bestScore = score;
    }
  }
  if (!best) {
    const article = [...walk(root)].find((e) => e.tag === "article" || e.tag === "main");
    return article ?? root;
  }
  // Widen to an enclosing <article>/<main> when it is mostly the same content.
  const len = textOf(best).length;
  for (let p = best.parent; p; p = p.parent) {
    if ((p.tag === "article" || p.tag === "main") && textOf(p).length <= len * 1.6) return p;
  }
  return best;
}

function imageUrl(attrs: Record<string, string>, base: string): string | undefined {
  const raw =
    attrs["data-src"] ??
    attrs["data-lazy-src"] ??
    attrs["data-original"] ??
    (attrs.src && !attrs.src.startsWith("data:") ? attrs.src : undefined) ??
    (attrs["data-srcset"] ?? attrs.srcset)?.split(",")[0]?.trim().split(/\s+/)[0];
  return raw ? resolveHttpUrl(raw.trim(), base) : undefined;
}

function tinyImage(attrs: Record<string, string>): boolean {
  const w = parseInt(attrs.width ?? "", 10);
  const h = parseInt(attrs.height ?? "", 10);
  return (w > 0 && w < 48) || (h > 0 && h < 48);
}

function collapse(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const text = r.text.replace(/[ \t\r\f\v]+/g, " ").replace(/ ?\n ?/g, "\n");
    if (!text) continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.bold === r.bold &&
      prev.italic === r.italic &&
      prev.code === r.code &&
      prev.href === r.href
    )
      prev.text += text;
    else out.push({ ...r, text });
  }
  // Trim the paragraph's outer whitespace and double spaces across run boundaries.
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && /\s$/.test(out[i - 1]!.text)) out[i]!.text = out[i]!.text.replace(/^ +/, "");
  }
  if (out[0]) out[0].text = out[0].text.replace(/^\s+/, "");
  const last = out[out.length - 1];
  if (last) last.text = last.text.replace(/\s+$/, "");
  return out
    .filter((r) => r.text)
    .map((r) => (r.text.length > MAX_RUN_TEXT ? { ...r, text: r.text.slice(0, MAX_RUN_TEXT) } : r));
}

const runsText = (runs: Run[]) => runs.map((r) => r.text).join("");

class Builder {
  blocks: Block[] = [];
  chars = 0;
  images = 0;
  private inline: Run[] = [];
  private seenImages = new Set<string>();

  constructor(
    private base: string,
    private title: string,
  ) {}

  full() {
    return this.blocks.length >= MAX_BLOCKS || this.chars >= MAX_CHARS;
  }

  push(b: Block) {
    if (this.full()) return;
    this.blocks.push(b);
    this.chars += JSON.stringify(b).length;
  }

  flush() {
    const runs = collapse(this.inline);
    this.inline = [];
    if (runs.length && runsText(runs).trim()) this.push({ type: "paragraph", runs });
  }

  /** Inline content of an element as runs (links, emphasis, inline code, line breaks). */
  runs(n: Node, marks: Omit<Run, "text"> = {}, out: Run[] = []): Run[] {
    if (typeof n === "string") {
      out.push({ ...marks, text: n });
      return out;
    }
    const m = { ...marks };
    if (n.tag === "strong" || n.tag === "b") m.bold = true;
    if (n.tag === "em" || n.tag === "i" || n.tag === "cite") m.italic = true;
    if (n.tag === "code" || n.tag === "kbd" || n.tag === "samp") m.code = true;
    if (n.tag === "a") {
      const href = n.attrs.href ? resolveHttpUrl(n.attrs.href.trim(), this.base) : undefined;
      if (href) m.href = href;
    }
    if (n.tag === "br") out.push({ ...marks, text: "\n" });
    if (n.tag === "img") return out;
    for (const c of n.children) this.runs(c, m, out);
    return out;
  }

  image(attrs: Record<string, string>, caption?: string) {
    if (tinyImage(attrs) || this.images >= MAX_IMAGES) return;
    const src = imageUrl(attrs, this.base);
    if (!src || this.seenImages.has(src)) return;
    this.seenImages.add(src);
    this.images++;
    const alt = attrs.alt?.replace(/\s+/g, " ").trim().slice(0, 500) || undefined;
    this.push({ type: "image", src, alt, caption });
  }

  list(el: El) {
    const items: Run[][] = [];
    const visit = (list: El) => {
      for (const li of list.children) {
        if (typeof li === "string" || li.tag !== "li") continue;
        const own: Run[] = [];
        const nested: El[] = [];
        for (const c of li.children) {
          if (typeof c !== "string" && (c.tag === "ul" || c.tag === "ol")) nested.push(c);
          else this.runs(c, {}, own);
        }
        const runs = collapse(own);
        if (runs.length) items.push(runs);
        nested.forEach(visit);
        if (items.length >= 200) return;
      }
    };
    visit(el);
    if (items.length) this.push({ type: "list", ordered: el.tag === "ol", items });
  }

  table(el: El) {
    const rows: string[][] = [];
    let header = false;
    for (const tr of walk(el)) {
      if (tr.tag !== "tr" || rows.length >= 60) continue;
      const cells = tr.children.filter(
        (c): c is El => typeof c !== "string" && (c.tag === "td" || c.tag === "th"),
      );
      if (rows.length === 0 && cells.length && cells.every((c) => c.tag === "th")) header = true;
      const row = cells
        .slice(0, 12)
        .map((c) => textOf(c).replace(/\s+/g, " ").trim().slice(0, 500));
      if (row.some(Boolean)) rows.push(row);
    }
    // Layout tables (one column, or one row) read better as plain paragraphs.
    if (rows.length < 2 || Math.max(...rows.map((r) => r.length)) < 2) {
      this.children(el);
      return;
    }
    this.push({ type: "table", rows, header });
  }

  children(el: El) {
    for (const c of el.children) this.node(c);
  }

  node(n: Node) {
    if (this.full()) return;
    if (typeof n === "string") {
      this.inline.push({ text: n });
      return;
    }
    const tag = n.tag;
    if (!BLOCKISH.has(tag) && tag !== "img" && tag !== "picture") {
      // Inline element: add to the running paragraph unless it wraps block content.
      if (hasBlockContent(n)) {
        this.children(n);
      } else this.runs(n, {}, this.inline);
      return;
    }
    if (tag === "img") {
      this.flush();
      this.image(n.attrs);
      return;
    }
    if (tag === "picture") {
      this.flush();
      const img = [...walk(n)].find((d) => d.tag === "img");
      if (img) this.image(img.attrs);
      return;
    }
    this.flush();
    switch (tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const text = textOf(n).replace(/\s+/g, " ").trim().slice(0, 500);
        if (!text || (tag === "h1" && sameText(text, this.title))) break;
        const level = tag === "h1" || tag === "h2" ? 2 : tag === "h3" ? 3 : 4;
        this.push({ type: "heading", level, text });
        break;
      }
      case "p": {
        const imgs = [...walk(n)].filter((d) => d.tag === "img");
        this.runs(n, {}, this.inline);
        this.flush();
        imgs.forEach((i) => this.image(i.attrs));
        break;
      }
      case "ul":
      case "ol":
        this.list(n);
        break;
      case "blockquote": {
        const parts: Run[] = [];
        for (const c of n.children) {
          if (typeof c !== "string" && BLOCKISH.has(c.tag)) {
            if (parts.length) parts.push({ text: "\n\n" });
            this.runs(c, {}, parts);
          } else this.runs(c, {}, parts);
        }
        const runs = collapse(parts);
        if (runs.length) this.push({ type: "quote", runs });
        break;
      }
      case "pre": {
        const text = textOf(n).replace(/^\n/, "").replace(/\s+$/, "").slice(0, 20_000);
        const cls = [n.attrs.class, ...[...walk(n)].map((d) => d.attrs.class)].join(" ");
        const lang = cls.match(/(?:lang|language)-([\w+#-]{1,20})/)?.[1];
        if (text) this.push({ type: "code", text, ...(lang ? { lang } : {}) });
        break;
      }
      case "figure": {
        const cap = [...walk(n)].find((d) => d.tag === "figcaption");
        const caption = cap ? textOf(cap).replace(/\s+/g, " ").trim().slice(0, 500) : undefined;
        const imgs = [...walk(n)].filter((d) => d.tag === "img");
        if (imgs.length) imgs.forEach((i, k) => this.image(i.attrs, k === 0 ? caption : undefined));
        else {
          for (const c of n.children) if (c !== cap) this.node(c);
          this.flush();
        }
        break;
      }
      case "figcaption":
        break;
      case "table":
        this.table(n);
        break;
      case "hr":
        if (this.blocks.length && this.blocks[this.blocks.length - 1]!.type !== "rule")
          this.push({ type: "rule" });
        break;
      default:
        this.children(n);
        this.flush();
    }
  }
}

function sameText(a: string, b: string) {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || y.startsWith(x) || x.startsWith(y));
}

export function countWords(blocks: Block[]): number {
  let n = 0;
  const add = (s: string) => (n += s.split(/\s+/).filter(Boolean).length);
  for (const b of blocks) {
    if (b.type === "heading" || b.type === "code") add(b.text);
    else if (b.type === "paragraph" || b.type === "quote") add(runsText(b.runs));
    else if (b.type === "list") b.items.forEach((i) => add(runsText(i)));
    else if (b.type === "table") b.rows.forEach((r) => r.forEach(add));
  }
  return n;
}

/** Plain text of the article, for search indexing. */
export function readerText(content: ReaderContent): string {
  return content.blocks
    .map((b) => {
      if (b.type === "heading" || b.type === "code") return b.text;
      if (b.type === "paragraph" || b.type === "quote") return runsText(b.runs);
      if (b.type === "list") return b.items.map(runsText).join("\n");
      if (b.type === "table") return b.rows.map((r) => r.join(" · ")).join("\n");
      if (b.type === "image") return b.caption ?? "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Minutes to read at ~230 words per minute (at least one). */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 230));
}

/**
 * Extracts the readable article from `html`. Returns null when the page has no real prose
 * (an app shell, a login wall, a video page), so callers can fall back to the description.
 */
export function extractReader(html: string, pageUrl: string, title = ""): ReaderContent | null {
  const root = parseTree(html);
  const content = findContentRoot(root);
  const b = new Builder(pageUrl, title);
  b.node(content);
  b.flush();
  // Drop leading/trailing rules and images that duplicate each other.
  const blocks = b.blocks.filter(
    (x, i, all) => !(x.type === "rule" && (i === 0 || i === all.length - 1)),
  );
  const words = countWords(blocks);
  if (words < 40) return null;
  return { v: 1, blocks, words };
}
