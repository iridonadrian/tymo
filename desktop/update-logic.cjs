// Pure helpers for the update check (no Electron), so they can be unit-tested.

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

/** Compares "1.2.3" versions; a pre-release suffix is ignored. */
function isNewer(latest, current) {
  const parse = (v) =>
    String(v)
      .replace(/^v/, "")
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** The file this computer needs, by the names the release workflow gives them. */
function pickAsset(assets, platform, arch) {
  const ending =
    platform === "darwin"
      ? `-mac-${arch === "arm64" ? "arm64" : "x64"}.dmg`
      : platform === "win32"
        ? "-win-x64.exe"
        : ".AppImage";
  return assets.find((a) => typeof a?.name === "string" && a.name.endsWith(ending)) ?? null;
}

function safeDownloadUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && ALLOWED_DOWNLOAD_HOSTS.has(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

module.exports = { isNewer, pickAsset, safeDownloadUrl };
