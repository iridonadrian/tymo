/**
 * Update check: once a day (and from the menu) ask GitHub for the latest release. If it is
 * newer, offer to download the file for this computer, then open it and quit so it can be
 * installed. Unsigned builds can't replace themselves silently, so the user stays in charge.
 *
 * The releases repository is written into package.json by the release workflow
 * (`tymo.releases`); development builds have none and never check.
 */
const { app, dialog, net, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const { isNewer, pickAsset, safeDownloadUrl } = require("./update-logic.cjs");

const DAY = 24 * 60 * 60 * 1000;

const repo = (() => {
  try {
    const r = require("./package.json").tymo?.releases;
    return typeof r === "string" && /^[\w.-]+\/[\w.-]+$/.test(r) ? r : null;
  } catch {
    return null;
  }
})();

const prefsFile = () => path.join(app.getPath("userData"), "update-prefs.json");

function readPrefs() {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile(), "utf8"));
    return { auto: p.auto !== false, skip: typeof p.skip === "string" ? p.skip : null };
  } catch {
    return { auto: true, skip: null };
  }
}

function writePrefs(patch) {
  try {
    fs.writeFileSync(prefsFile(), JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    /* not fatal */
  }
}

async function latestRelease() {
  const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Tymo-Desktop" },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const r = await res.json();
  if (r.draft || r.prerelease || typeof r.tag_name !== "string") return null;
  return {
    version: r.tag_name.replace(/^v/, ""),
    page: safeDownloadUrl(r.html_url)?.toString() ?? null,
    asset: pickAsset(Array.isArray(r.assets) ? r.assets : [], process.platform, process.arch),
  };
}

async function download(asset, win) {
  const url = safeDownloadUrl(asset.browser_download_url);
  if (!url) throw new Error("Unexpected download address");
  const name = path.basename(asset.name).replace(/[^\w.-]/g, "_");
  const target = path.join(app.getPath("downloads"), name);
  const res = await net.fetch(url.toString(), { headers: { "User-Agent": "Tymo-Desktop" } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(asset.size) || Number(res.headers.get("content-length")) || 0;
  const tmp = `${target}.part`;
  const out = fs.createWriteStream(tmp);
  let got = 0;
  try {
    for await (const chunk of res.body) {
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      if (total && win && !win.isDestroyed()) win.setProgressBar(got / total);
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } finally {
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
  }
  if (asset.size && got !== Number(asset.size)) {
    fs.rmSync(tmp, { force: true });
    throw new Error("The download was incomplete. Please try again.");
  }
  fs.renameSync(tmp, target);
  if (process.platform === "linux") fs.chmodSync(target, 0o755);
  return target;
}

let busy = false;

/** `manual`: from the menu, so also say when there's nothing new or the check failed. */
async function checkForUpdates({ manual = false, getWindow = () => null } = {}) {
  if (busy) return;
  if (!repo) {
    if (manual)
      dialog.showMessageBox({ message: "Update checks are only available in released builds." });
    return;
  }
  busy = true;
  try {
    const latest = await latestRelease();
    const current = app.getVersion();
    if (!latest || !isNewer(latest.version, current)) {
      if (manual)
        await dialog.showMessageBox({
          message: "Tymo is up to date",
          detail: `You have the latest version (${current}).`,
        });
      return;
    }
    if (!manual && readPrefs().skip === latest.version) return;

    const win = getWindow();
    const { response, checkboxChecked } = await dialog.showMessageBox(win ?? undefined, {
      type: "info",
      buttons: latest.asset
        ? ["Download and Install", "What's New", "Later"]
        : ["Open Download Page", "Later"],
      defaultId: 0,
      cancelId: latest.asset ? 2 : 1,
      message: `Tymo ${latest.version} is available`,
      detail: `You have ${current}. Your library stays where it is when you update.`,
      checkboxLabel: manual ? undefined : "Don't remind me about this version",
    });
    if (checkboxChecked) writePrefs({ skip: latest.version });

    if (!latest.asset) {
      if (response === 0 && latest.page) shell.openExternal(latest.page);
      return;
    }
    if (response === 1) {
      if (latest.page) shell.openExternal(latest.page);
      return;
    }
    if (response !== 0) return;

    const file = await download(latest.asset, win);
    const how =
      process.platform === "darwin"
        ? "Tymo will close and the new version will open in a window: drag Tymo into Applications and choose Replace. Then open Tymo again."
        : process.platform === "win32"
          ? "Tymo will close and the installer will start. Tymo opens again when it's done."
          : `Tymo will close. The new version is in your Downloads folder (${path.basename(file)}).`;
    await dialog.showMessageBox(win ?? undefined, {
      message: `Tymo ${latest.version} is downloaded`,
      detail: how,
    });
    if (process.platform === "linux") shell.showItemInFolder(file);
    else await shell.openPath(file);
    app.quit();
  } catch (err) {
    if (manual)
      dialog.showMessageBox({
        type: "warning",
        message: "Couldn't check for updates",
        detail: String(err?.message ?? err),
      });
  } finally {
    busy = false;
  }
}

/** Checks shortly after start and then daily, unless turned off in the menu. */
function startAutomaticChecks(getWindow) {
  if (!repo) return;
  const run = () => readPrefs().auto && checkForUpdates({ getWindow });
  setTimeout(run, 15_000);
  setInterval(run, DAY).unref?.();
}

module.exports = {
  checkForUpdates,
  startAutomaticChecks,
  automaticChecksEnabled: () => readPrefs().auto,
  setAutomaticChecks: (on) => writePrefs({ auto: !!on }),
  hasReleaseSource: () => !!repo,
};
