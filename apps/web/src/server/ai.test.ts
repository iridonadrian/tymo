import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import { OLLAMA_BASE, complete, embeddingConfig, interpretWithAi } from "./ai";
import { aiSettingsSchema, saveAiSettings } from "./settings";

let reply = "ok";
let last: { url?: string; auth?: string; body?: { model?: string } } = {};
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    last = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-ai-"));
  await resetDbForTests(`file:${path.join(dir, `a${n++}.db`)}`);
});

describe("ollama provider", () => {
  it("talks OpenAI-format chat to the local server without a key, with local defaults", async () => {
    await saveAiSettings({ provider: "ollama", baseUrl: base });
    reply = "hello";
    expect(await complete("sys", "hi")).toBe("hello");
    expect(last.url).toBe("/v1/chat/completions");
    expect(last.auth).toBeUndefined();
    expect(last.body?.model).toBe("llama3.2");
  });

  it("defaults embeddings to nomic-embed-text on the local Ollama", () => {
    const s = aiSettingsSchema.parse({ provider: "ollama", semanticSearch: true });
    expect(embeddingConfig(s)).toEqual({
      wire: "openai",
      base: OLLAMA_BASE,
      model: "nomic-embed-text",
      apiKey: "",
      id: `openai:${OLLAMA_BASE}:nomic-embed-text`,
    });
  });

  it("never sends a chat key to a different embeddings host", () => {
    const s = aiSettingsSchema.parse({
      provider: "openai",
      apiKey: "sk-secret",
      semanticSearch: true,
      embeddingBaseUrl: "http://127.0.0.1:11434/v1",
    });
    expect(embeddingConfig(s)!.apiKey).toBe("");
  });
});

describe("interpretWithAi", () => {
  it("returns one clean line of query syntax", async () => {
    await saveAiSettings({ provider: "ollama", baseUrl: base });
    reply = "Query: `type:article after:2026-09-01 rust`\u0007\nExplanation: …";
    expect(await interpretWithAi("rust articles this month")).toBe(
      "type:article after:2026-09-01 rust",
    );
  });
});
