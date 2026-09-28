/**
 * Turns a fetched page into a self-contained, inert archive copy.
 *
 * Everything that could execute or phone home is removed (scripts, frames, plugins, event
 * handlers, <base>, refresh/CSP metas, non-http URLs). Stylesheets and images are inlined by
 * the caller (fetched with the server's SSRF-safe client) so the copy renders offline.
 * The server additionally serves archives with `Content-Security-Policy: sandbox;
 * default-src 'none'`, so this rewrite is defence in depth, not the only barrier.
 */
import { Parser } from "htmlparser2";
import { resolveHttpUrl } from "./url";

export const MAX_ARCHIVE_STYLESHEETS = 12;
export const MAX_ARCHIVE_IMAGES = 80;

/** Elements removed together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "applet",
  "template",
  "portal",
  "fencedframe",
]);
/** Elements removed but whose children are kept (e.g. <noscript> fallbacks become visible). */
const UNWRAP = new Set(["noscript"]);
/** Void elements dropped outright. */
const DROP_VOID = new Set(["base", "embed", "param", "track"]);
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const URL_ATTRS = new Set(["href", "src", "cite", "poster", "xlink:href", "background"]);
const DROP_ATTRS = new Set([
  "srcset",
  "srcdoc",
  "action",
  "formaction",
  "ping",
  "integrity",
  "nonce",
  "data-src",
  "data-srcset",
  "data-lazy-src",
  "data-original",
  "imagesrcset",
  "sizes",
  "loading",
]);

function decodeAttr(v: string): string {
  return v
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function firstSrcsetUrl(srcset: string | undefined): string | undefined {
  return srcset?.split(",")[0]?.trim().split(/\s+/)[0];
}

/** The URL an <img> would actually show, including common lazy-loading attributes. */
function imageCandidate(attribs: Record<string, string>): string | undefined {
  const raw =
    attribs["data-src"] ??
    attribs["data-lazy-src"] ??
    attribs["data-original"] ??
    (attribs.src && !attribs.src.startsWith("data:") ? attribs.src : undefined) ??
    firstSrcsetUrl(attribs["data-srcset"] ?? attribs.srcset);
  return raw ? decodeAttr(raw).trim() : undefined;
}

function isStylesheet(attribs: Record<string, string>) {
  return (attribs.rel ?? "").toLowerCase().split(/\s+/).includes("stylesheet");
}

export interface ArchiveResources {
  stylesheets: string[];
  images: string[];
}

/** Absolute http(s) URLs of stylesheets and images the archive should inline. */
export function collectArchiveResources(html: string, baseUrl: string): ArchiveResources {
  const stylesheets: string[] = [];
  const images: string[] = [];
  let skip = 0;
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (DROP_WITH_CONTENT.has(name)) skip++;
        if (skip) return;
        if (name === "link" && isStylesheet(attribs) && attribs.href) {
          const u = resolveHttpUrl(decodeAttr(attribs.href), baseUrl);
          if (u && !stylesheets.includes(u) && stylesheets.length < MAX_ARCHIVE_STYLESHEETS)
            stylesheets.push(u);
        }
        if (name === "img") {
          const raw = imageCandidate(attribs);
          const u = raw && resolveHttpUrl(raw, baseUrl);
          if (u && !images.includes(u) && images.length < MAX_ARCHIVE_IMAGES) images.push(u);
        }
      },
      onclosetag(name) {
        if (DROP_WITH_CONTENT.has(name) && skip) skip--;
      },
    },
    { decodeEntities: false, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();
  return { stylesheets, images };
}

export interface RewriteOptions {
  /** Inlined CSS by absolute stylesheet URL. */
  styles: Map<string, string>;
  /** data: URIs by absolute image URL. */
  images: Map<string, string>;
  originalUrl: string;
  archivedAt: number;
  title?: string;
}

function banner(o: RewriteOptions) {
  const when = new Date(o.archivedAt).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const url = escapeAttr(o.originalUrl);
  return (
    `<div style="all:initial;display:block;position:sticky;top:0;z-index:2147483647;` +
    `background:#141414;color:#a7a7a7;border-bottom:1px solid #313131;` +
    `font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:6px 12px">` +
    `ARCHIVED BY TYMO · ${escapeText(when)} · ` +
    `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#6798ff">${escapeText(o.originalUrl)}</a>` +
    `</div>`
  );
}

/** Rewrites untrusted HTML into an inert, self-contained archive document. */
export function rewriteForArchive(html: string, baseUrl: string, o: RewriteOptions): string {
  const out: string[] = [];
  let skip = 0;
  let bannerDone = false;
  let headDone = false;
  const head = `<meta charset="utf-8"><meta name="referrer" content="no-referrer">`;

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (DROP_WITH_CONTENT.has(name)) {
          skip++;
          return;
        }
        if (skip || UNWRAP.has(name) || DROP_VOID.has(name)) return;
        if (name === "meta") {
          const equiv = (attribs["http-equiv"] ?? "").toLowerCase();
          if (equiv || "charset" in attribs) return; // refresh, CSP, content-type, charset
        }
        if (name === "link") {
          if (isStylesheet(attribs) && attribs.href) {
            const u = resolveHttpUrl(decodeAttr(attribs.href), baseUrl);
            const css = u ? o.styles.get(u) : undefined;
            if (css) out.push(`<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`);
          }
          // Preloads, icons, manifests, prefetches: nothing to keep offline.
          return;
        }

        const kept: string[] = [];
        for (const [key, rawValue] of Object.entries(attribs)) {
          if (key.startsWith("on") || DROP_ATTRS.has(key)) continue;
          if (URL_ATTRS.has(key)) {
            if (name === "img" && key === "src") continue; // handled below
            if (["video", "audio", "source", "input"].includes(name) && key === "src") continue;
            const v = decodeAttr(rawValue).trim();
            if (v.startsWith("#")) {
              kept.push(`${key}="${escapeAttr(v)}"`);
              continue;
            }
            const u = resolveHttpUrl(v, baseUrl);
            if (u) kept.push(`${key}="${escapeAttr(u)}"`);
            continue;
          }
          if (key === "style" && /expression\s*\(|javascript:/i.test(rawValue)) continue;
          kept.push(`${key}="${escapeAttr(decodeAttr(rawValue))}"`);
        }
        if (name === "img") {
          const raw = imageCandidate(attribs);
          const u = raw && resolveHttpUrl(raw, baseUrl);
          const data = u ? o.images.get(u) : undefined;
          if (data) kept.push(`src="${escapeAttr(data)}"`);
        }
        if (name === "a" && kept.some((k) => k.startsWith("href="))) {
          for (const k of ["target", "rel"]) {
            const i = kept.findIndex((x) => x.startsWith(`${k}=`));
            if (i >= 0) kept.splice(i, 1);
          }
          kept.push('target="_blank"', 'rel="noopener noreferrer"');
        }
        out.push(`<${name}${kept.length ? " " + kept.join(" ") : ""}>`);
        if (name === "head" && !headDone) {
          out.push(head);
          headDone = true;
        }
        if (name === "body" && !bannerDone) {
          out.push(banner(o));
          bannerDone = true;
        }
      },
      ontext(text) {
        if (!skip) out.push(text);
      },
      onclosetag(name) {
        if (DROP_WITH_CONTENT.has(name)) {
          if (skip) skip--;
          return;
        }
        if (skip || UNWRAP.has(name) || VOID.has(name)) return;
        out.push(`</${name}>`);
      },
      oncomment() {
        /* comments dropped (conditional comments can load resources in old engines) */
      },
    },
    {
      decodeEntities: false,
      lowerCaseTags: true,
      lowerCaseAttributeNames: true,
      recognizeSelfClosing: true,
    },
  );
  parser.write(html);
  parser.end();

  const doc = out.join("");
  return "<!doctype html>" + (headDone ? "" : head) + (bannerDone ? "" : banner(o)) + doc;
}
