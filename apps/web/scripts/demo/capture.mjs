#!/usr/bin/env node
/**
 * Screenshots for the README, taken from the demo library (see seed.ts).
 * Run after `npm run build -w @tymo/web`:
 *
 *   TYMO_DATA_DIR=/demo/folder node apps/web/scripts/demo/capture.mjs [docs/screenshots]
 *
 * Starts the production server on a spare port against that folder, then saves PNGs.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const web = path.resolve(fileURLToPath(import.meta.url), "../../..");
const dataDir = process.env.TYMO_DATA_DIR;
if (!dataDir) throw new Error("Set TYMO_DATA_DIR to the demo library folder");
const outDir = path.resolve(process.argv[2] ?? path.join(web, "../../docs/screenshots"));
const port = Number(process.env.PORT ?? 3288);
const base = `http://127.0.0.1:${port}`;

// The standalone server expects static assets next to it.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-capture-"));
fs.cpSync(path.join(web, ".next/standalone"), stage, { recursive: true });
fs.cpSync(path.join(web, ".next/static"), path.join(stage, "apps/web/.next/static"), {
  recursive: true,
});
fs.cpSync(path.join(web, "public"), path.join(stage, "apps/web/public"), { recursive: true });

const server = spawn(process.execPath, [path.join(stage, "apps/web/server.js")], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    TYMO_DATA_DIR: path.resolve(dataDir),
    TYMO_MIGRATIONS_DIR: path.join(web, "drizzle"),
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: "inherit",
});
const stop = () => {
  server.kill();
  fs.rmSync(stage, { recursive: true, force: true });
};
process.on("exit", stop);

for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${base}/api/health`)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 100) throw new Error("server did not start");
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch({ executablePath: process.env.TYMO_CHROMIUM || undefined });
fs.mkdirSync(outDir, { recursive: true });

async function context(theme, viewport = { width: 1440, height: 900 }, mobile = false) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 1.5,
    colorScheme: theme,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: "reduce",
  });
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem("tymo:view")) localStorage.setItem("tymo:view", "grid");
    } catch {
      /* storage unavailable */
    }
  });
  return ctx;
}

async function visit(page, url) {
  await page.goto(base + url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(`  ${name}.png`);
}

const shots = {
  async board(page) {
    await visit(page, "/saves");
    await page.waitForTimeout(1500); // colours are measured on first view
    await visit(page, "/saves");
    await shot(page, "board");
  },
  async bookmarks(page) {
    await visit(page, "/bookmarks");
    await shot(page, "bookmarks");
  },
  async reader(page) {
    const ids = JSON.parse(fs.readFileSync(path.join(dataDir, "demo.json"), "utf8"));
    await visit(page, `/read/${ids.article}`);
    await shot(page, "reader");
  },
  async search(page) {
    await visit(page, "/saves?q=" + encodeURIComponent("red things I saved this week"));
    await shot(page, "search");
  },
  async session(page) {
    await visit(page, "/sessions");
    const link = page.locator('a[href^="/sessions/"]').first();
    if (await link.count()) await visit(page, await link.getAttribute("href"));
    await shot(page, "session");
  },
  async detail(page) {
    await visit(page, "/saves?q=Arc%20lounge%20chair");
    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    await shot(page, "detail");
  },
  async palette(page) {
    await visit(page, "/");
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("kyoto");
    await page.waitForTimeout(700);
    await shot(page, "command-palette");
  },
};

const only = process.env.SHOTS?.split(",");
const dark = await context("dark");
for (const [name, fn] of Object.entries(shots)) {
  if (only && !only.includes(name)) continue;
  const page = await dark.newPage();
  await fn(page);
  await page.close();
}
if (!only || only.includes("light")) {
  const light = await context("light");
  const page = await light.newPage();
  await visit(page, "/saves");
  await shot(page, "board-light");
  await light.close();
}
if (!only || only.includes("mobile")) {
  const phone = await context("dark", { width: 390, height: 844 }, true);
  const page = await phone.newPage();
  await visit(page, "/saves");
  await shot(page, "mobile");
  await phone.close();
}
await browser.close();
process.exit(0);
