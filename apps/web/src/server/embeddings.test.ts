import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import { createSave, deleteSaves, listSaves, relatedSaves } from "./saves";
import { saveAiSettings } from "./settings";
import {
  embeddingStatus,
  flushEmbeddings,
  nearDuplicatePairs,
  queueMissingEmbeddings,
  resetEmbeddingsForTests,
} from "./embeddings";

/** Words sharing a concept land on the same axis, so "automobile" ≈ "car". */
const CONCEPTS: Record<string, number> = {
  car: 0,
  cars: 0,
  automobile: 0,
  vehicle: 0,
  driving: 0,
  pasta: 1,
  recipe: 1,
  cooking: 1,
  food: 1,
  osint: 2,
  security: 2,
  recon: 2,
};

function fakeEmbedding(text: string): number[] {
  const v = new Array(16).fill(0.01);
  for (const w of text.toLowerCase().split(/[^a-z]+/)) {
    if (!w) continue;
    const axis = CONCEPTS[w] ?? 3 + ([...w].reduce((a, c) => a + c.charCodeAt(0), 0) % 13);
    v[axis] += CONCEPTS[w] !== undefined ? 3 : 0.2;
  }
  return v;
}

let calls = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls++;
    const { input } = JSON.parse(body) as { input: string[] };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ data: input.map((t, index) => ({ index, embedding: fakeEmbedding(t) })) }),
    );
  });
});

let base = "";
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => server.close());

let n = 0;
beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-emb-"));
  await resetDbForTests(`file:${path.join(dir, `e${n++}.db`)}`);
  resetEmbeddingsForTests();
  await saveAiSettings({
    provider: "openai",
    baseUrl: base,
    model: "chat",
    semanticSearch: true,
    embeddingModel: "fake",
  });
});

describe("semantic search", () => {
  it("finds saves by meaning and marks semantic-only hits", async () => {
    const car = await createSave({ title: "Buying a used automobile", type: "note", body: "x" });
    await createSave({ title: "Fresh pasta recipe", type: "note", body: "y" });
    await createSave({ title: "Car maintenance checklist", type: "note", body: "z" });
    await flushEmbeddings();
    expect((await embeddingStatus()).indexed).toBe(3);

    const res = await listSaves({ q: "car" });
    const titles = res.items.map((i) => i.title);
    expect(titles[0]).toBe("Car maintenance checklist");
    expect(titles).toContain("Buying a used automobile");
    expect(titles).not.toContain("Fresh pasta recipe");
    expect(res.items.find((i) => i.id === car.id)?.semantic).toBe(true);
    expect(res.items[0]!.semantic).toBeUndefined();

    // Filters still apply to semantic matches.
    expect((await listSaves({ q: "car type:link" })).items).toHaveLength(0);
    // Semantic can be switched off per query.
    expect((await listSaves({ q: "car", semantic: false })).items).toHaveLength(1);
  });

  it("does not re-embed unchanged text and forgets deleted saves", async () => {
    const a = await createSave({ title: "OSINT recon tools", type: "note" });
    await flushEmbeddings();
    const before = calls;
    await queueMissingEmbeddings();
    await flushEmbeddings();
    expect(calls).toBe(before);
    await deleteSaves([a.id]);
    expect((await listSaves({ q: "security" })).items).toHaveLength(0);
  });

  it("returns related saves and near-duplicate pairs", async () => {
    const a = await createSave({ title: "Security recon with OSINT", type: "note" });
    const b = await createSave({ title: "OSINT security recon", type: "note" });
    await createSave({ title: "Pasta cooking", type: "note" });
    await flushEmbeddings();
    const rel = await relatedSaves(a.id, 1);
    expect(rel.map((r) => r.id)).toEqual([b.id]);
    const pairs = await nearDuplicatePairs(0.95);
    expect(pairs).toHaveLength(1);
    expect([pairs[0]!.a, pairs[0]!.b].sort()).toEqual([a.id, b.id].sort());
  });

  it("falls back to keyword related saves without embeddings", async () => {
    await saveAiSettings({ semanticSearch: false });
    const a = await createSave({ title: "Kubernetes networking deep dive", type: "note" });
    const b = await createSave({ title: "Kubernetes operators explained", type: "note" });
    await createSave({ title: "Sourdough starter", type: "note" });
    expect((await relatedSaves(a.id)).map((r) => r.id)).toEqual([b.id]);
  });
});
