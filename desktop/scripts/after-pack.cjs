// electron-builder leaves node_modules and dot-folders (.next) out of extraResources, and the
// server needs both. So the staged server is copied in here, after packing and before the
// app is signed.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const resources =
    electronPlatformName === "darwin" || electronPlatformName === "mas"
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");
  const from = path.join(__dirname, "..", "server");
  if (!fs.existsSync(path.join(from, "apps/web/server.js")))
    throw new Error("desktop/server is missing: run `npm run stage` first");
  const to = path.join(resources, "server");
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
};
