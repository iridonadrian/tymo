/**
 * Tymo MCP server (stdio). Lets MCP clients — Claude Desktop, Claude Code, and others —
 * search and add to a Tymo library through its REST API.
 *
 *   TYMO_URL=http://127.0.0.1:3210 TYMO_TOKEN=tymo_… node dist/tymo-mcp.mjs
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TymoClient } from "./client";
import { createServer } from "./server";

const url = process.env.TYMO_URL || "http://127.0.0.1:3210";
const token = process.env.TYMO_TOKEN;
if (!token) {
  console.error("TYMO_TOKEN is required (create one in Tymo → Settings → Browser extension).");
  process.exit(1);
}

// The token grants full access to the library: only send it in clear text to this machine.
try {
  const u = new URL(url);
  if (u.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))
    console.error(
      `[tymo-mcp] Warning: ${u.host} is reached over plain HTTP, so the API token travels unencrypted. Use https://.`,
    );
} catch {
  console.error("TYMO_URL is not a valid URL.");
  process.exit(1);
}

await createServer(new TymoClient({ url, token })).connect(new StdioServerTransport());
