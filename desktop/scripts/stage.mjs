#!/usr/bin/env node
// Copies the web app's standalone server into desktop/server, the folder electron-builder
// ships as resources/server. Run `npm run build -w @tymo/web` in the repo root first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(fileURLToPath(import.meta.url), "../..");
const web = path.resolve(desktop, "../apps/web");
const out = path.join(desktop, "server");
const standalone = path.join(web, ".next/standalone");

if (!fs.existsSync(path.join(standalone, "apps/web/server.js")))
  throw new Error(
    "No server build found. Run `npm run build -w @tymo/web` in the repo root first.",
  );

fs.rmSync(out, { recursive: true, force: true });
const copy = (from, to) => fs.cpSync(from, to, { recursive: true });

/** Next links some packages; real copies keep the app self-contained on every OS and
 *  satisfy macOS code signing, which rejects symlinks inside the app bundle. */
function replaceSymlinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.realpathSync(p);
      fs.rmSync(p);
      fs.cpSync(target, p, { recursive: true });
      if (fs.statSync(p).isDirectory()) replaceSymlinks(p);
    } else if (entry.isDirectory()) {
      replaceSymlinks(p);
    }
  }
}

copy(standalone, out);
replaceSymlinks(out);
copy(path.join(web, ".next/static"), path.join(out, "apps/web/.next/static"));
copy(path.join(web, "public"), path.join(out, "apps/web/public"));
copy(path.join(web, "drizzle"), path.join(out, "apps/web/drizzle"));
// Never ship a library or local settings that happened to be in the build folder.
for (const junk of ["apps/web/data", "apps/web/.env", "apps/web/.env.local"])
  fs.rmSync(path.join(out, junk), { recursive: true, force: true });
console.log(`Staged server in ${path.relative(process.cwd(), out) || "."}`);
