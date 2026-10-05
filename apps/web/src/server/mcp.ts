/**
 * Remote MCP server (Streamable HTTP at /mcp) for claude.ai connectors and other remote MCP
 * clients. Same tools as the local stdio server (apps/mcp), but talking to the database
 * directly. Stateless: each HTTP request gets a fresh server + transport, so nothing is
 * kept in memory between calls and it works behind any proxy.
 */
import { revalidatePath } from "next/cache";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createSaveInput, updateSaveInput } from "@tymo/core";
import { MCP_INSTRUCTIONS, TOOLS, type LibraryClient } from "@tymo/core/mcp-tools";
import { listCollections } from "./collections";
import { enqueueEnrichment } from "./enrich";
import { createSave, getSave, getSaveText, listSaves, relatedSaves, updateSave } from "./saves";
import { listTags } from "./tags";

/** The library, in-process: the same shapes the REST API returns. */
export const localLibrary: LibraryClient = {
  async search(p) {
    const view = ["all", "inbox", "favorites", "archive"].includes(p.view ?? "")
      ? (p.view as "all")
      : undefined;
    // Assistants often phrase queries naturally; operator syntax is left untouched.
    return listSaves({ q: p.q, view, limit: p.limit, offset: p.offset, natural: true });
  },
  async get(id) {
    const save = await getSave(id);
    if (!save) throw new Error("Save not found");
    return { ...save, text: await getSaveText(id) };
  },
  async related(id) {
    if (!(await getSave(id))) throw new Error("Save not found");
    return { items: await relatedSaves(id, 10) };
  },
  async create(input) {
    const r = await createSave(createSaveInput.parse(input), { captureMethod: "api" });
    if (r.needsEnrichment) enqueueEnrichment([r.id]);
    revalidatePath("/", "layout");
    return r;
  },
  async update(id, input) {
    if (!(await getSave(id))) throw new Error("Save not found");
    await updateSave(id, updateSaveInput.parse(input));
    revalidatePath("/", "layout");
    return (await getSave(id))!;
  },
  async collections() {
    const cols = await listCollections();
    return {
      collections: cols
        .filter((c) => !c.smart)
        .map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
    };
  },
  async tags() {
    return { tags: (await listTags()).slice(0, 500).map((t) => t.name) };
  },
};

/** An MCP server exposing the library; read-only grants only see read-only tools. */
export function createMcpServer(client: LibraryClient, opts: { canWrite: boolean }): McpServer {
  const server = new McpServer(
    { name: "tymo", version: "0.1.0" },
    {
      instructions: MCP_INSTRUCTIONS,
    },
  );
  for (const t of TOOLS) {
    if (!t.readOnly && !opts.canWrite) continue;
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

/** Handles one Streamable HTTP request (JSON responses, no sessions). */
export async function handleMcpRequest(req: Request, canWrite: boolean): Promise<Response> {
  const server = createMcpServer(localLibrary, { canWrite });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 1024 * 1024,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Stateless: the response body is already materialised (JSON mode).
    void transport.close();
    void server.close();
  }
}
