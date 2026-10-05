import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_INSTRUCTIONS, TOOLS, type LibraryClient } from "@tymo/core/mcp-tools";

export function createServer(client: LibraryClient): McpServer {
  const server = new McpServer(
    { name: "tymo", version: "0.1.0" },
    { instructions: MCP_INSTRUCTIONS },
  );
  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: { readOnlyHint: t.readOnly, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        try {
          return { content: [{ type: "text" as const, text: await t.run(client, args) }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
        }
      },
    );
  }
  return server;
}
