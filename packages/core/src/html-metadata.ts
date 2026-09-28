/**
 * Extracts page metadata from untrusted HTML using a streaming tokenizer.
 * Nothing is executed or rendered; only strings are collected, then length-capped.
 */
import { Parser } from "htmlparser2";
import { resolveHttpUrl } from "./url";
import { extractFacts, type Facts } from "./facts";

export interface PageMetadata {
  title?: string;
  description?: string;
  siteName?: string;
  imageUrl?: string;
  faviconUrl?: string;
  canonicalUrl?: string;
  ogType?: string;
  jsonLdTypes: string[];
  author?: string;
  publishedAt?: string;
  /** Recipe/product/book/film/place details for rich cards. */
  facts?: Facts;
  text: string;
}

const MAX_TEXT = 20_000;
const SKIP_TEXT_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "head",
  "iframe",
  "object",
]);
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "li",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "tr",
  "section",
  "article",
  "pre",
  "blockquote",
]);

function clean(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const v = value
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return v ? v.slice(0, max) : undefined;
}

function collectLdTypes(node: unknown, out: Set<string>, depth = 0) {
  if (depth > 6 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node.slice(0, 50)) collectLdTypes(n, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") out.add(t);
  else if (Array.isArray(t))
    t.filter((x): x is string => typeof x === "string").forEach((x) => out.add(x));
  if (obj["@graph"]) collectLdTypes(obj["@graph"], out, depth + 1);
}

export function parseHtmlMetadata(html: string, pageUrl: string): PageMetadata {
  const meta = new Map<string, string>();
  const icons: { href: string; rel: string; sizes: number }[] = [];
  let canonical: string | undefined;
  let title = "";
  let inTitle = false;
  let skipDepth = 0;
  let bodyText = "";
  let ldBuffer: string | null = null;
  const ldTypes = new Set<string>();
  const ldDocs: unknown[] = [];
  let baseHref: string | undefined;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === "base" && attrs.href && !baseHref) baseHref = attrs.href;
        if (name === "title" && !title) inTitle = true;
        if (name === "meta") {
          const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase().trim();
          if (key && attrs.content != null && !meta.has(key)) meta.set(key, attrs.content);
        }
        if (name === "link" && attrs.href) {
          const rel = (attrs.rel || "").toLowerCase();
          if (rel.split(/\s+/).includes("canonical")) canonical ??= attrs.href;
          if (
            /(^|\s)(icon|shortcut icon|apple-touch-icon|apple-touch-icon-precomposed)(\s|$)/.test(
              rel,
            )
          ) {
            const sizes = parseInt((attrs.sizes || "").split("x")[0] || "0", 10) || 0;
            icons.push({ href: attrs.href, rel, sizes });
          }
        }
        if (name === "script" && (attrs.type || "").toLowerCase() === "application/ld+json") {
          ldBuffer = "";
        }
        if (SKIP_TEXT_TAGS.has(name)) skipDepth++;
        if (BLOCK_TAGS.has(name) && bodyText.length < MAX_TEXT) bodyText += "\n";
      },
      ontext(text) {
        if (inTitle) title += text;
        if (ldBuffer !== null && ldBuffer.length < 200_000) ldBuffer += text;
        if (skipDepth === 0 && bodyText.length < MAX_TEXT) bodyText += text;
      },
      onclosetag(name) {
        if (name === "title") inTitle = false;
        if (name === "script" && ldBuffer !== null) {
          try {
            const doc: unknown = JSON.parse(ldBuffer);
            collectLdTypes(doc, ldTypes);
            if (ldDocs.length < 10) ldDocs.push(doc);
          } catch {
            /* malformed JSON-LD is common; ignore */
          }
          ldBuffer = null;
        }
        if (SKIP_TEXT_TAGS.has(name) && skipDepth > 0) skipDepth--;
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();

  const base = resolveHttpUrl(baseHref, pageUrl) ?? pageUrl;
  const pick = (...keys: string[]) => keys.map((k) => meta.get(k)).find((v) => v && v.trim());

  // Prefer the largest declared icon, then any icon, then /favicon.ico.
  icons.sort((a, b) => b.sizes - a.sizes);
  const faviconUrl =
    icons.map((i) => resolveHttpUrl(i.href, base)).find(Boolean) ??
    resolveHttpUrl("/favicon.ico", pageUrl);

  const text = bodyText
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT);

  return {
    title: clean(pick("og:title", "twitter:title") ?? title, 500) ?? clean(title, 500),
    description: clean(pick("og:description", "twitter:description", "description"), 1000),
    siteName: clean(pick("og:site_name", "application-name"), 200),
    imageUrl: resolveHttpUrl(
      pick("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"),
      base,
    ),
    faviconUrl,
    canonicalUrl: resolveHttpUrl(canonical, base),
    ogType: clean(pick("og:type"), 50),
    jsonLdTypes: [...ldTypes].slice(0, 20),
    author: clean(pick("author", "article:author", "twitter:creator"), 200),
    publishedAt: clean(pick("article:published_time", "date", "pubdate"), 50),
    facts: extractFacts(ldDocs, meta),
    text,
  };
}
