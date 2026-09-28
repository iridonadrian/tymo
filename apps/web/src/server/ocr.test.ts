import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import { createSave, getSave, listSaves } from "./saves";
import { storeFile } from "./files";
import { saveAiSettings } from "./settings";
import { ocrSave, parseImageReading } from "./ocr";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
let reply = "Invoice #4711\nTotal due: 99 EUR\n";
let lastBody: {
  messages: { role: string; content: string | { type: string; image_url?: { url: string } }[] }[];
} | null = null;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    lastBody = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: reply } }],
      }),
    );
  });
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
});
afterAll(() => server.close());

let n = 0;
beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-ocr-"));
  await resetDbForTests(`file:${path.join(dir, `o${n++}.db`)}`);
  await saveAiSettings({
    provider: "openai",
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    model: "vision",
    ocr: true,
  });
});

describe("ocr", () => {
  it("sends the image to the vision model and indexes the text", async () => {
    const { id } = await createSave({ title: "Screenshot", type: "screenshot" });
    await storeFile(PNG, { saveId: id, kind: "screenshot" });

    expect(await ocrSave(id)).toBe("Invoice #4711\nTotal due: 99 EUR".length);
    const content = lastBody!.messages[1]!.content as {
      type: string;
      image_url?: { url: string };
    }[];
    expect(content.find((c) => c.type === "image_url")!.image_url!.url).toMatch(
      /^data:image\/png;base64,/,
    );
    expect((await getSave(id))!.imageText).toBe("Invoice #4711\nTotal due: 99 EUR");
    expect((await listSaves({ q: "invoice" })).items.map((i) => i.id)).toEqual([id]);
  });

  it("stores a searchable description of what the image shows", async () => {
    reply = "DESCRIPTION: A pair of white sneakers on a wooden floor.\nTEXT:\nAIR\n";
    const { id } = await createSave({ title: "IMG_2041", type: "image" });
    await storeFile(PNG, { saveId: id, kind: "upload" });
    await ocrSave(id);
    const save = (await getSave(id))!;
    expect(save.metadata).toMatchObject({
      imageDescription: "A pair of white sneakers on a wooden floor.",
    });
    expect(save.imageText).toBe("AIR");
    expect((await listSaves({ q: "sneakers" })).items.map((i) => i.id)).toEqual([id]);
    reply = "Invoice #4711\nTotal due: 99 EUR\n";
  });

  it("parses replies with and without the format", () => {
    expect(parseImageReading("DESCRIPTION: A cat.\nTEXT:\n")).toEqual({
      description: "A cat.",
      text: "",
    });
    expect(parseImageReading("description:  Two\n lines \n TEXT:\nhello\nworld")).toEqual({
      description: "Two lines",
      text: "hello\nworld",
    });
    expect(parseImageReading("just text")).toEqual({ description: "", text: "just text" });
  });

  it("explains when there is nothing to read", async () => {
    const { id } = await createSave({ title: "Note", type: "note", body: "x" });
    await expect(ocrSave(id)).rejects.toThrow(/no image/);
  });
});
