import { describe, expect, it } from "vitest";
import { collectArchiveResources, rewriteForArchive } from "./archive";

const BASE = "https://example.com/blog/post";
const PAGE = `<!DOCTYPE html>
<html><head>
  <meta charset="iso-8859-1"><meta http-equiv="refresh" content="0;url=https://evil.test">
  <base href="https://evil.test/">
  <title>Post &amp; more</title>
  <link rel="stylesheet" href="/css/site.css"><link rel="preload" href="/x.js" as="script">
  <script>alert(1)</script>
</head>
<body onload="steal()">
  <h1 class="t">Hello</h1>
  <p>Text with <a href="../about?a=1&amp;b=2" target="_self">link</a> and <a href="javascript:alert(1)">bad</a>.</p>
  <img src="/img/a.png" alt="A" onerror="x()"><img data-src="https://cdn.example.com/b.jpg" src="data:image/gif;base64,R0l">
  <iframe src="https://ads.test"><p>inside</p></iframe>
  <noscript><img src="/img/c.png"></noscript>
  <svg><script>alert(2)</script><a xlink:href="javascript:alert(3)">x</a></svg>
  <form action="https://evil.test/post"><input name="q"></form>
</body></html>`;

describe("archive", () => {
  it("collects stylesheets and images, including lazy and noscript images", () => {
    expect(collectArchiveResources(PAGE, BASE)).toEqual({
      stylesheets: ["https://example.com/css/site.css"],
      images: [
        "https://example.com/img/a.png",
        "https://cdn.example.com/b.jpg",
        "https://example.com/img/c.png",
      ],
    });
  });

  it("produces an inert, self-contained document", () => {
    const out = rewriteForArchive(PAGE, BASE, {
      styles: new Map([["https://example.com/css/site.css", "h1{color:red}</style><script>"]]),
      images: new Map([["https://example.com/img/a.png", "data:image/png;base64,AAAA"]]),
      originalUrl: BASE,
      archivedAt: Date.UTC(2026, 0, 2, 3, 4),
    });
    expect(out.startsWith("<!doctype html>")).toBe(true);
    // The CSS can't close its <style> element early; "<script>" inside it is inert text.
    expect(out).toContain("<style>h1{color:red}<\\/style><script></style>");
    const withoutCss = out.replace(/<style>[\s\S]*?<\/style>/g, "");
    expect(withoutCss).not.toMatch(
      /<script|<iframe|<base|http-equiv|onload|onerror|javascript:|evil\.test|x\.js/i,
    );
    expect(out).toContain('<img alt="A" src="data:image/png;base64,AAAA">');
    // Unavailable images lose their src instead of loading remotely.
    expect(out).not.toContain("cdn.example.com");
    expect(out).toContain(
      '<a href="https://example.com/about?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">link</a>',
    );
    expect(out).toContain("<title>Post &amp; more</title>");
    expect(out).toContain('<meta charset="utf-8">');
    expect(out).toContain("ARCHIVED BY TYMO · 2026-01-02 03:04 UTC");
    expect(out).not.toContain("inside");
    expect(out).toContain('<form><input name="q"></form>');
  });

  it("handles fragments without html/head/body", () => {
    const out = rewriteForArchive("<p>hi<script>x</script></p>", BASE, {
      styles: new Map(),
      images: new Map(),
      originalUrl: BASE,
      archivedAt: 0,
    });
    expect(out).toMatch(/^<!doctype html><meta charset="utf-8">.*ARCHIVED BY TYMO.*<p>hi<\/p>$/s);
  });
});
