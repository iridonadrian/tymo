import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import { saveAiSettings } from "./settings";
import { cancelPull, ollamaStatus, startPull } from "./ollama";
import { isInstalled } from "../lib/ai-models";

const installed = [{ name: "llama3.2:latest", size: 2000 }];
const server = http.createServer((req, res) => {
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: installed }));
  if (req.url === "/api/pull") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { model } = JSON.parse(body) as { model: string };
      if (model === "missing:1b")
        return res.end(JSON.stringify({ error: "model not found" }) + "\n");
      const line = (o: object) => res.write(JSON.stringify(o) + "\n");
      line({ status: "pulling manifest" });
      line({ status: "pulling a", digest: "a", total: 100, completed: 40 });
      line({ status: "pulling b", digest: "b", total: 50, completed: 50 });
      setTimeout(() => {
        line({ status: "pulling a", digest: "a", total: 100, completed: 100 });
        line({ status: "success" });
        installed.push({ name: model, size: 150 });
        res.end();
      }, 50);
    });
    return;
  }
  res.statusCode = 404;
  res.end();
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-ollama-"));
  await resetDbForTests(`file:${path.join(dir, "o.db")}`);
  await saveAiSettings({ provider: "ollama", baseUrl: `http://127.0.0.1:${port}/v1` });
});
afterAll(() => server.close());

const waitDone = async () => {
  for (let i = 0; i < 100; i++) {
    const s = await ollamaStatus();
    if (s.pull?.done) return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("pull never finished");
};

describe("one-click Ollama setup", () => {
  it("lists installed models and matches names without a tag", async () => {
    const s = await ollamaStatus();
    expect(s.running).toBe(true);
    expect(isInstalled(s.models, "llama3.2")).toBe(true);
    expect(isInstalled(s.models, "qwen2.5:14b")).toBe(false);
  });

  it("downloads a model and reports progress across layers", async () => {
    await startPull("qwen2.5:14b");
    const s = await waitDone();
    expect(s.pull).toMatchObject({ model: "qwen2.5:14b", done: true, error: null });
    expect(s.pull!.completed).toBe(150);
    expect(s.pull!.total).toBe(150);
    expect(isInstalled(s.models, "qwen2.5:14b")).toBe(true);
  });

  it("shows Ollama's error and rejects bad names", async () => {
    await startPull("missing:1b");
    expect((await waitDone()).pull?.error).toBe("model not found");
    await expect(startPull("../etc; rm -rf")).rejects.toThrow(/valid model name/);
    cancelPull(); // nothing running: no-op
  });

  it("reports when Ollama isn't running", async () => {
    await saveAiSettings({ provider: "ollama", baseUrl: "http://127.0.0.1:9/v1" });
    expect((await ollamaStatus()).running).toBe(false);
  });
});
