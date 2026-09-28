import { describe, expect, it } from "vitest";
import { parseHtmlMetadata } from "./html-metadata";

const html = `<!doctype html><html><head>
<title>  Fallback   Title </title>
<meta property="og:title" content="Incident Response &amp; DFIR">
<meta name="description" content="How to respond">
<meta property="og:image" content="/img/cover.png">
<meta property="og:type" content="article">
<link rel="icon" href="/favicon-16.png" sizes="16x16">
<link rel="apple-touch-icon" href="https://cdn.example.com/icon-180.png" sizes="180x180">
<link rel="canonical" href="https://example.com/canonical">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BlogPosting"}]}</script>
<script>var secret = "do not index";</script>
</head><body><nav>Menu</nav><h1>Heading</h1><p>First paragraph.</p><style>.x{}</style><p>Second</p>
<a href="javascript:alert(1)">x</a></body></html>`;

describe("parseHtmlMetadata", () => {
  const m = parseHtmlMetadata(html, "https://example.com/post");
  it("extracts fields", () => {
    expect(m.title).toBe("Incident Response & DFIR");
    expect(m.description).toBe("How to respond");
    expect(m.imageUrl).toBe("https://example.com/img/cover.png");
    expect(m.faviconUrl).toBe("https://cdn.example.com/icon-180.png");
    expect(m.canonicalUrl).toBe("https://example.com/canonical");
    expect(m.ogType).toBe("article");
    expect(m.jsonLdTypes).toContain("BlogPosting");
  });
  it("extracts visible text only", () => {
    expect(m.text).toContain("First paragraph.");
    expect(m.text).toContain("Second");
    expect(m.text).not.toContain("do not index");
    expect(m.text).not.toContain(".x{}");
  });
  it("drops non-http image urls and falls back to /favicon.ico", () => {
    const x = parseHtmlMetadata(
      `<meta property="og:image" content="javascript:alert(1)"><title>t</title>`,
      "https://a.com/b",
    );
    expect(x.imageUrl).toBeUndefined();
    expect(x.faviconUrl).toBe("https://a.com/favicon.ico");
    expect(x.title).toBe("t");
  });
  it("survives garbage", () => {
    expect(() =>
      parseHtmlMetadata("<<<>>><script type='application/ld+json'>{bad", "https://a.com"),
    ).not.toThrow();
  });
});
