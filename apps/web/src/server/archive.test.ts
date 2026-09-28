import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The SSRF guard only allows standard ports and (with this escape hatch) loopback.
process.env.TYMO_UNSAFE_ALLOW_PRIVATE_FETCH = "1";
const PORT = 8080;
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

const server = http.createServer((req, res) => {
  if (req.url === "/page") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html><head><title>Archived article</title>
      <link rel="stylesheet" href="/site.css"><script>document.title="pwned"</script></head>
      <body><h1>Headline</h1><img src="/pic.png" alt="pic"><img src="/missing.png"></body></html>`);
  } else if (req.url === "/site.css") {
    res.setHeader("content-type", "text/css");
    res.end("h1 { color: rebeccapurple }");
  } else if (req.url === "/pic.png") {
    res.setHeader("content-type", "image/png");
    res.end(PNG);
  } else if (req.url === "/moved") {
    res.statusCode = 301;
    res.setHeader("location", "/page");
    res.end();
  } else if (req.url === "/file.pdf") {
    res.setHeader("content-type", "application/pdf");
    res.end("%PDF-1.7");
  } else {
    res.statusCode = 404;
    res.end("nope");
  }
});

let available = true;
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.once("error", () => {
      available = false;
      resolve();
    });
    server.listen(PORT, "127.0.0.1", resolve);
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-arch-"));
  const { resetDbForTests } = await import("./db");
  await resetDbForTests(`file:${path.join(dir, "a.db")}`);
});
afterAll(() => server.close());

describe("archiveSave", () => {
  it("stores an inert, self-contained copy of the page", async (ctx) => {
    if (!available) ctx.skip();
    const { createSave, getSave } = await import("./saves");
    const { archiveSave } = await import("./archive");
    const { readStoredFile } = await import("./files");

    const { id } = await createSave({ url: `http://127.0.0.1:${PORT}/page`, title: "Page" });
    const r = await archiveSave(id);
    expect(r).toMatchObject({ images: 1, stylesheets: 1 });

    const file = await readStoredFile(r.fileId);
    expect(file!.row.kind).toBe("snapshot");
    expect(file!.row.mime).toBe("text/html; charset=utf-8");
    const html = new TextDecoder().decode(file!.data);
    expect(html).toContain("<style>h1 { color: rebeccapurple }</style>");
    expect(html).toContain('<img alt="pic" src="data:image/png;base64,');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("/missing.png");
    expect(html).toContain("ARCHIVED BY TYMO");

    // Re-archiving replaces the old copy; snapshots don't become the save's "file".
    const again = await archiveSave(id);
    const save = await getSave(id);
    expect(save!.files.filter((f) => f.kind === "snapshot").map((f) => f.id)).toEqual([
      again.fileId,
    ]);
    expect(save!.fileId).toBeNull();
    expect(save!.metadata?.archivedAt).toBeTypeOf("number");
    expect(await readStoredFile(r.fileId)).toBeNull();
  });

  it("refuses non-HTML URLs and saves without a URL", async (ctx) => {
    if (!available) ctx.skip();
    const { createSave } = await import("./saves");
    const { archiveSave } = await import("./archive");
    const pdf = await createSave({ url: `http://127.0.0.1:${PORT}/file.pdf`, title: "PDF" });
    await expect(archiveSave(pdf.id)).rejects.toThrow(/not a web page/);
    const note = await createSave({ title: "Note", type: "note", body: "x" });
    await expect(archiveSave(note.id)).rejects.toThrow(/URL/);
  });

  it("checks links: ok, moved and broken", async (ctx) => {
    if (!available) ctx.skip();
    const { createSave, listSaves, getSave } = await import("./saves");
    const { checkLink, checkLinksBatch, brokenCount } = await import("./linkcheck");
    const ok = await createSave({ url: `http://127.0.0.1:${PORT}/page`, title: "OK" });
    const moved = await createSave({ url: `http://127.0.0.1:${PORT}/moved`, title: "Moved" });
    const gone = await createSave({ url: `http://127.0.0.1:${PORT}/gone`, title: "Gone" });
    expect((await checkLink(moved.id))!.status).toBe("moved");
    const r = await checkLinksBatch(10);
    expect(r.checked).toBeGreaterThanOrEqual(2);
    expect((await getSave(gone.id))!.linkStatus).toBe("broken");
    expect((await getSave(ok.id))!.linkStatus).toBeNull();
    expect((await getSave(moved.id))!.linkStatus).toBe("moved");
    expect(await brokenCount()).toBe(1);
    expect((await listSaves({ q: "is:broken" })).items.map((i) => i.id)).toEqual([gone.id]);
    // Recently checked links are skipped.
    expect((await checkLinksBatch(10)).checked).toBe(0);
  });
});
