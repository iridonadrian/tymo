// Builds the extension for Chromium (MV3 service worker) and Firefox (MV3 event page).
import { build, context } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.dirname(new URL(import.meta.url).pathname);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const watch = process.argv.includes("--watch");
const zip = process.argv.includes("--zip");

function manifest(target) {
  const m = {
    manifest_version: 3,
    name: "Tymo — Save it. Close it. Find it later.",
    short_name: "Tymo",
    version: pkg.version,
    description: "Save pages, links, screenshots and whole tab sessions to your own Tymo library.",
    icons: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" },
    action: {
      default_popup: "popup.html",
      default_title: "Save to Tymo (Alt+Shift+S)",
      default_icon: { 16: "icons/16.png", 32: "icons/32.png" },
    },
    options_ui: { page: "options.html", open_in_tab: true },
    // Minimal permissions: no content scripts, no <all_urls>, host access only for the user's own server.
    permissions: ["activeTab", "tabs", "storage", "contextMenus"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
    commands: {
      _execute_action: {
        suggested_key: { default: "Alt+Shift+S" },
        description: "Open quick save",
      },
      "save-tab": {
        suggested_key: { default: "Alt+Shift+D" },
        description: "Save current tab instantly",
      },
      "save-session": {
        suggested_key: { default: "Alt+Shift+E" },
        description: "Save all tabs in this window as a session",
      },
    },
  };
  if (target === "chrome") {
    m.permissions.push("tabGroups");
    m.background = { service_worker: "background.js" };
    m.minimum_chrome_version = "114";
  } else {
    m.background = { scripts: ["background.js"] };
    m.browser_specific_settings = {
      gecko: {
        id: "tymo@tymo.extension",
        strict_min_version: "128.0",
        data_collection_permissions: { required: ["none"] },
      },
    };
  }
  return m;
}

const targets = ["chrome", "firefox"];
for (const target of targets) {
  const out = path.join(root, "dist", target);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "icons"), { recursive: true });
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest(target), null, 2));
  for (const f of ["popup.html", "options.html", "styles.css"])
    fs.copyFileSync(path.join(root, "src", f), path.join(out, f));
  for (const f of fs.readdirSync(path.join(root, "icons")))
    fs.copyFileSync(path.join(root, "icons", f), path.join(out, "icons", f));
  const opts = {
    entryPoints: {
      background: "src/background.ts",
      popup: "src/popup.ts",
      options: "src/options.ts",
    },
    bundle: true,
    format: "iife",
    target: ["chrome114", "firefox128"],
    outdir: out,
    absWorkingDir: root,
    minify: !watch,
    sourcemap: watch ? "inline" : false,
    define: { __TARGET__: JSON.stringify(target) },
    logLevel: "warning",
  };
  if (watch) await (await context(opts)).watch();
  else await build(opts);
  if (zip) {
    const file = path.join(root, `tymo-${target}-${pkg.version}.zip`);
    fs.rmSync(file, { force: true });
    execFileSync("zip", ["-qr", file, "."], { cwd: out });
    console.log("packaged", path.relative(root, file));
  }
}
console.log(watch ? "watching…" : `built dist/{${targets.join(",")}}`);
