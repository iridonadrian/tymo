import { describe, expect, it } from "vitest";
import { extractReader, readerText, readingMinutes, type Block } from "./reader";

const lorem =
  "Tymo keeps the things you find online, so you can close the tab without worrying, and find it again later with search, tags and collections.";

function page(body: string) {
  return `<!doctype html><html><head><title>A good article</title>
    <script>alert(1)</script><style>p{color:red}</style></head>
    <body>
      <nav class="site-nav"><a href="/">Home</a><a href="/about">About</a></nav>
      <header><h1>Site name</h1></header>
      ${body}
      <aside class="sidebar"><p>${lorem} Sidebar text that should not appear.</p></aside>
      <div class="comments"><p>${lorem} A reader comment that should not appear.</p></div>
      <footer><p>© Someone. ${lorem}</p></footer>
    </body></html>`;
}

const types = (blocks: Block[]) => blocks.map((b) => b.type);

describe("extractReader", () => {
  const html = page(`
    <article class="post">
      <h1>A good article</h1>
      <p>${lorem} <strong>Bold words</strong>, <em>italic words</em> and a
        <a href="/docs/start?x=1">relative link</a>, plus <code>npm test</code>.</p>
      <h2>Getting started</h2>
      <p>${lorem}<br>Second line.</p>
      <ul><li>First <b>item</b></li><li>Second item<ul><li>Nested item</li></ul></li></ul>
      <ol><li>One</li><li>Two</li></ol>
      <blockquote><p>${lorem}</p><p>Quoted again.</p></blockquote>
      <pre><code class="language-ts">const x = 1;
  console.log(x);</code></pre>
      <figure><img src="/img/photo.jpg" alt="A photo" width="800"><figcaption>The caption</figcaption></figure>
      <img src="/pixel.gif" width="1" height="1">
      <img src="data:image/png;base64,AAAA">
      <table><tr><th>Name</th><th>Value</th></tr><tr><td>a</td><td>1</td></tr></table>
      <p onclick="steal()">Click <a href="javascript:alert(1)">me</a> for ${lorem}</p>
      <div style="display:none"><p>${lorem} hidden paragraph</p></div>
    </article>`);
  const r = extractReader(html, "https://example.com/blog/post", "A good article")!;

  it("keeps the article and drops chrome, scripts, comments and hidden content", () => {
    expect(r).not.toBeNull();
    const text = readerText(r);
    expect(text).toContain("Bold words");
    expect(text).not.toMatch(/Sidebar text|reader comment|©|Home|alert|color:red|hidden paragraph/);
    expect(text).not.toContain("Site name");
  });

  it("produces structured blocks in order, skipping the duplicate title", () => {
    expect(types(r.blocks)).toEqual([
      "paragraph",
      "heading",
      "paragraph",
      "list",
      "list",
      "quote",
      "code",
      "image",
      "table",
      "paragraph",
    ]);
  });

  it("keeps inline marks and resolves links, rejecting non-http ones", () => {
    const p = r.blocks[0] as Extract<Block, { type: "paragraph" }>;
    expect(p.runs).toContainEqual({ text: "Bold words", bold: true });
    expect(p.runs).toContainEqual({ text: "italic words", italic: true });
    expect(p.runs).toContainEqual({ text: "npm test", code: true });
    expect(p.runs).toContainEqual({
      text: "relative link",
      href: "https://example.com/docs/start?x=1",
    });
    const last = r.blocks.at(-1) as Extract<Block, { type: "paragraph" }>;
    expect(last.runs.some((x) => x.href)).toBe(false);
    expect(last.runs.map((x) => x.text).join("")).toContain("Click me");
  });

  it("keeps line breaks, lists (flattening nesting), quotes, code and tables", () => {
    const p = r.blocks[2] as Extract<Block, { type: "paragraph" }>;
    expect(p.runs.map((x) => x.text).join("")).toMatch(
      /later with search, tags and collections\.\nSecond line\.$/,
    );
    const ul = r.blocks[3] as Extract<Block, { type: "list" }>;
    expect(ul.ordered).toBe(false);
    expect(ul.items.map((i) => i.map((x) => x.text).join(""))).toEqual([
      "First item",
      "Second item",
      "Nested item",
    ]);
    expect((r.blocks[4] as Extract<Block, { type: "list" }>).ordered).toBe(true);
    const q = r.blocks[5] as Extract<Block, { type: "quote" }>;
    expect(q.runs.map((x) => x.text).join("")).toMatch(/collections\.\n\nQuoted again\.$/);
    expect(r.blocks[6]).toEqual({
      type: "code",
      text: "const x = 1;\n  console.log(x);",
      lang: "ts",
    });
    expect(r.blocks[8]).toEqual({
      type: "table",
      header: true,
      rows: [
        ["Name", "Value"],
        ["a", "1"],
      ],
    });
  });

  it("keeps real images with captions, dropping pixels and data URIs", () => {
    const imgs = r.blocks.filter((b) => b.type === "image");
    expect(imgs).toEqual([
      {
        type: "image",
        src: "https://example.com/img/photo.jpg",
        alt: "A photo",
        caption: "The caption",
      },
    ]);
  });

  it("counts words", () => {
    expect(r.words).toBeGreaterThan(80);
    expect(readingMinutes(r.words)).toBe(1);
    expect(readingMinutes(2300)).toBe(10);
  });

  it("finds the content without an <article> element", () => {
    const html = page(`<div id="wrapper"><div class="entry-content">
      <p>${lorem}</p><p>${lorem}</p><p>${lorem}</p></div>
      <div class="share-buttons"><a href="#">Share</a></div></div>`);
    const r = extractReader(html, "https://example.com/p")!;
    expect(types(r.blocks)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(readerText(r)).not.toContain("Share");
  });

  it("drops related-post, newsletter and share blocks inside the article", () => {
    const html = page(`<article class="post"><div class="post-content">
      <p>${lorem}</p><p>${lorem}</p></div>
      <section class="related-posts"><h3>Related</h3><p>${lorem} Another post</p></section>
      <div class="newsletter-signup"><p>${lorem} Get posts by email</p></div>
      <div class="social-share"><a href="https://x.com/share">Share on X</a></div></article>`);
    const text = readerText(extractReader(html, "https://example.com/p")!);
    expect(text).not.toMatch(/Related|Another post|by email|Share on X/);
  });

  it("uses lazy-loaded image sources", () => {
    const html = page(`<article><p>${lorem} ${lorem}</p>
      <img data-src="https://cdn.example.com/a.webp" src="data:image/gif;base64,R0l" alt="">
      <picture><source srcset="/b.avif"><img srcset="/b.jpg 1x, /b@2x.jpg 2x"></picture></article>`);
    const r = extractReader(html, "https://example.com/p")!;
    expect(
      r.blocks.filter((b) => b.type === "image").map((b) => (b as { src: string }).src),
    ).toEqual(["https://cdn.example.com/a.webp", "https://example.com/b.jpg"]);
  });

  it("returns null for pages without real prose", () => {
    expect(extractReader(page(`<div id="app"></div>`), "https://example.com")).toBeNull();
    expect(extractReader("", "https://example.com")).toBeNull();
    expect(extractReader(page(`<p>Log in to continue.</p>`), "https://example.com")).toBeNull();
  });

  it("survives malformed markup and caps output", () => {
    const huge = `<article>${`<p>${lorem} <b>unclosed <i>tags</p>`.repeat(3000)}</article>`;
    const r = extractReader(huge, "https://example.com")!;
    expect(r.blocks.length).toBeLessThanOrEqual(600);
    expect(JSON.stringify(r).length).toBeLessThan(200_000);
  });
});
