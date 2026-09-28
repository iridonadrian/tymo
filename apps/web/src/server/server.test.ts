import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import {
  bulkUpdate,
  createSave,
  deleteSaves,
  getSave,
  listSaves,
  updateSave,
  libraryStats,
} from "./saves";
import { createCollection, listCollections, previewRules, deleteCollection } from "./collections";
import { createSession, getSession, listSessions } from "./sessions";
import { importBookmarksHtml, importJson } from "./importer";
import { exportLibrary } from "./exporter";
import { safeFetch } from "./fetcher";
import { sniffMime, storeFile, readStoredFile } from "./files";
import { createApiToken, verifyApiToken, revokeApiToken } from "./tokens";
import { issueSessionCookie, verifySessionCookie, checkPassword } from "./auth";

let n = 0;
beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-db-"));
  await resetDbForTests(`file:${path.join(dir, `t${n++}.db`)}`);
});

describe("saves", () => {
  it("creates into inbox, dedupes, and searches", async () => {
    const a = await createSave({
      url: "https://github.com/projectdiscovery/nuclei?utm_source=x",
      tags: ["OSINT", "tools"],
    });
    expect(a.duplicate).toBe(false);
    const s = await getSave(a.id);
    expect(s).toMatchObject({
      type: "repo",
      status: "inbox",
      domain: "github.com",
      tags: ["osint", "tools"],
    });
    expect(s!.url).toBe("https://github.com/projectdiscovery/nuclei");

    const dup = await createSave({
      url: "https://www.github.com/projectdiscovery/nuclei/",
      tags: ["scanner"],
    });
    expect(dup).toMatchObject({ id: a.id, duplicate: true });
    expect((await getSave(a.id))!.tags).toEqual(["osint", "scanner", "tools"]);

    await createSave({
      title: "Incident response checklist",
      body: "Contain, eradicate, recover",
      tags: ["dfir"],
    });
    expect((await listSaves({ q: "nucl" })).items.map((i) => i.id)).toEqual([a.id]);
    expect((await listSaves({ q: "eradicat" })).total).toBe(1);
    expect((await listSaves({ q: "tag:osint" })).total).toBe(1);
    expect((await listSaves({ q: "#dfir" })).total).toBe(1);
    expect((await listSaves({ q: "domain:github.com type:repo" })).total).toBe(1);
    expect((await listSaves({ q: 'nuclei OR "' })).total).toBe(0); // FTS syntax is inert
    expect((await listSaves({ view: "inbox" })).total).toBe(2);
  });

  it("files into collections, bulk actions, delete", async () => {
    const col = await createCollection({ name: "Cybersecurity" });
    const a = await createSave({ url: "https://book.hacktricks.xyz/", collectionIds: [col] });
    expect((await getSave(a.id))!.status).toBe("active");
    const b = await createSave({ url: "https://example.com/b" });
    await bulkUpdate([b.id], { kind: "addToCollection", collectionId: col });
    expect((await listSaves({ collectionId: col })).total).toBe(2);
    expect((await listSaves({ q: 'collection:"cybersecurity"' })).total).toBe(2);
    await bulkUpdate([a.id, b.id], { kind: "archive" });
    expect((await listSaves({})).total).toBe(0);
    expect((await listSaves({ view: "archive" })).total).toBe(2);
    await updateSave(a.id, {
      archived: false,
      favorite: true,
      notes: "great ref",
      tags: ["pentest"],
    });
    expect((await listSaves({ view: "favorites" })).items[0]!.id).toBe(a.id);
    expect((await listSaves({ q: "great" })).total).toBe(1);
    await deleteSaves([a.id]);
    expect(await getSave(a.id)).toBeNull();
    expect((await listSaves({ q: "great" })).total).toBe(0);
    await deleteCollection(col);
    expect(await listCollections()).toEqual([]);
  });

  it("smart collections match dynamically", async () => {
    await createSave({ url: "https://github.com/a/b", tags: ["security"] });
    await createSave({ url: "https://github.com/c/d" });
    await createSave({ url: "https://x.com/y", tags: ["cybersecurity"] });
    const rules = {
      groups: [
        [{ field: "tag" as const, op: "is" as const, value: "cybersecurity" }],
        [
          { field: "domain" as const, op: "contains" as const, value: "github.com" },
          { field: "tag" as const, op: "is" as const, value: "security" },
        ],
      ],
    };
    expect((await previewRules(rules)).count).toBe(2);
    const id = await createCollection({ name: "Sec", rules });
    expect((await listCollections())[0]!.count).toBe(2);
    await createSave({ url: "https://z.com", tags: ["cybersecurity"] });
    expect((await listSaves({ collectionId: id })).total).toBe(3);
  });
});

describe("sessions", () => {
  it("saves tabs in order, skips internal pages, reuses existing saves", async () => {
    const existing = await createSave({ url: "https://example.com/one" });
    const r = await createSession({
      name: "AI Research",
      tabs: [
        { url: "https://example.com/one", title: "One", windowIndex: 0 },
        { url: "chrome://settings", title: "Settings", windowIndex: 0 },
        {
          url: "https://example.com/two",
          title: "Two",
          windowIndex: 0,
          pinned: true,
          groupTitle: "G",
          groupColor: "blue",
        },
        { url: "https://example.com/three", title: "Three", windowIndex: 1 },
      ],
    });
    expect(r).toMatchObject({ saved: 3, skipped: 1 });
    const s = await getSession(r.id);
    expect(s!.items.map((i) => i.title)).toEqual(["One", "Two", "Three"]);
    expect(s!.items[0]!.saveId).toBe(existing.id);
    expect(s!.items[1]).toMatchObject({ pinned: true, groupTitle: "G" });
    expect((await listSessions())[0]).toMatchObject({
      name: "AI Research",
      tabCount: 3,
      windows: 2,
    });
    expect((await listSaves({ view: "inbox" })).total).toBe(1); // session tabs don't flood the inbox
    expect((await libraryStats()).sessions).toBe(1);
  });
});

describe("import / export", () => {
  it("imports bookmarks with folders and round-trips JSON", async () => {
    const r = await importBookmarksHtml(`<DL><p><DT><H3>Bookmarks bar</H3><DL><p>
      <DT><H3>AI Tools</H3><DL><p><DT><A HREF="https://a.ai/" ADD_DATE="1700000000">A</A></DL><p>
      <DT><A HREF="https://b.com/">B</A><DT><A HREF="javascript:x">bad</A></DL><p></DL>`);
    expect(r).toMatchObject({ imported: 2, skipped: 1, collections: 1 });
    const cols = await listCollections();
    expect(cols.map((c) => [c.name, c.count])).toEqual([["AI Tools", 1]]);
    const json = await exportLibrary("json");
    const csv = await exportLibrary("csv");
    expect(csv.body).toContain("https://a.ai/");
    const again = await importJson(json.body);
    expect(again).toMatchObject({ imported: 0, duplicates: 2 });
    await expect(importJson("{}")).rejects.toThrow();
  });
});

describe("files", () => {
  it("sniffs magic bytes and stores safely", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(sniffMime(png)).toBe("image/png");
    expect(sniffMime(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffMime(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    const save = await createSave({ title: "shot", type: "screenshot" });
    const f = await storeFile(png, {
      saveId: save.id,
      kind: "screenshot",
      originalName: "../../etc/passwd",
    });
    const back = await readStoredFile(f.id);
    expect(back!.row.mime).toBe("image/png");
    expect(back!.row.storageKey).not.toContain("..");
    await expect(
      storeFile(new TextEncoder().encode("<html>"), { saveId: save.id, kind: "upload" }),
    ).rejects.toThrow(/Unsupported/);
  });
});

describe("auth", () => {
  it("api tokens verify and revoke", async () => {
    const { id, token } = await createApiToken("ext");
    expect(await verifyApiToken(token)).toBeTruthy();
    expect(await verifyApiToken(token + "x")).toBeNull();
    await revokeApiToken(id);
    expect(await verifyApiToken(token)).toBeNull();
  });
  it("session cookies are signed and expire", () => {
    process.env.TYMO_PASSWORD = "hunter2";
    const c = issueSessionCookie();
    expect(verifySessionCookie(c)).toBe(true);
    // Tamper with the last MAC character (always to a different one).
    const tampered = c.slice(0, -1) + (c.endsWith("A") ? "B" : "A");
    expect(verifySessionCookie(tampered)).toBe(false);
    expect(verifySessionCookie(issueSessionCookie(0))).toBe(false);
    expect(checkPassword("hunter2")).toBe(true);
    expect(checkPassword("hunter3")).toBe(false);
    process.env.TYMO_PASSWORD = "";
    expect(verifySessionCookie(c)).toBe(false);
  });
});

describe("safeFetch (SSRF)", () => {
  const server = http.createServer((_req, res) => res.end("<title>internal</title>"));
  afterAll(() => server.close());

  it("refuses loopback, metadata, and redirects into private space", async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toThrow();
    await expect(safeFetch("http://localhost/")).rejects.toThrow();
    await expect(safeFetch("http://[::1]/")).rejects.toThrow();
    // A public-looking name that resolves to loopback is caught at connect time.
    await expect(safeFetch("http://localtest.me/")).rejects.toThrow();
  });
});
