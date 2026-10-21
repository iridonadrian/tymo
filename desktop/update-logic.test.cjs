const test = require("node:test");
const assert = require("node:assert/strict");
const { isNewer, pickAsset, safeDownloadUrl, assetSha256 } = require("./update-logic.cjs");

test("compares versions numerically", () => {
  assert.equal(isNewer("0.1.10", "0.1.9"), true);
  assert.equal(isNewer("v1.0.0", "0.9.9"), true);
  assert.equal(isNewer("0.1.1", "0.1.1"), false);
  assert.equal(isNewer("0.1.0", "0.1.1"), false);
  assert.equal(isNewer("0.2.0-beta.1", "0.1.9"), true);
});

test("picks the file for this computer", () => {
  const assets = [
    "Tymo-0.2.0-mac-arm64.dmg",
    "Tymo-0.2.0-mac-x64.dmg",
    "Tymo-0.2.0-win-x64.exe",
    "Tymo-0.2.0-linux-x86_64.AppImage",
    "Tymo-0.2.0-linux-arm64.AppImage",
    "Tymo-0.2.0-mac-arm64.dmg.blockmap",
  ].map((name) => ({ name }));
  assert.equal(pickAsset(assets, "darwin", "arm64").name, "Tymo-0.2.0-mac-arm64.dmg");
  assert.equal(pickAsset(assets, "darwin", "x64").name, "Tymo-0.2.0-mac-x64.dmg");
  assert.equal(pickAsset(assets, "win32", "x64").name, "Tymo-0.2.0-win-x64.exe");
  assert.equal(pickAsset(assets, "linux", "x64").name, "Tymo-0.2.0-linux-x86_64.AppImage");
  assert.equal(pickAsset(assets, "linux", "arm64").name, "Tymo-0.2.0-linux-arm64.AppImage");
  assert.equal(pickAsset(assets.slice(0, 4), "linux", "arm64"), null);
  assert.equal(pickAsset([], "darwin", "arm64"), null);
});

test("only downloads over https from GitHub", () => {
  assert.ok(safeDownloadUrl("https://github.com/o/r/releases/download/v1/Tymo.dmg"));
  assert.equal(safeDownloadUrl("http://github.com/o/r/Tymo.dmg"), null);
  assert.equal(safeDownloadUrl("https://evil.example/Tymo.dmg"), null);
  assert.equal(safeDownloadUrl("https://github.com.evil.example/Tymo.dmg"), null);
  assert.equal(safeDownloadUrl("javascript:alert(1)"), null);
});

test("reads GitHub's sha256 digest and nothing else", () => {
  const hex = "a".repeat(64);
  assert.equal(assetSha256({ digest: `sha256:${hex}` }), hex);
  assert.equal(assetSha256({ digest: `SHA256:${hex.toUpperCase()}` }), hex);
  assert.equal(assetSha256({ digest: `sha1:${"a".repeat(40)}` }), null);
  assert.equal(assetSha256({ digest: `sha256:${hex}0` }), null);
  assert.equal(assetSha256({}), null);
  assert.equal(assetSha256(null), null);
});
