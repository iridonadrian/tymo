// Bundles the MCP server into one executable file: dist/tymo-mcp.mjs
import { build } from "esbuild";
import fs from "node:fs";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/tymo-mcp.mjs",
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  legalComments: "none",
  logLevel: "warning",
});
fs.chmodSync("dist/tymo-mcp.mjs", 0o755);
console.log("built dist/tymo-mcp.mjs");
