/** Minimal client for Tymo's REST API (/api/v1), authenticated with an API token. */
import type { LibraryClient, SaveSummary } from "@tymo/core/mcp-tools";

export type { SaveSummary };
export interface TymoConfig {
  url: string;
  token: string;
  fetch?: typeof fetch;
}

export class TymoError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class TymoClient implements LibraryClient {
  private base: string;
  private doFetch: typeof fetch;

  constructor(private cfg: TymoConfig) {
    this.base = cfg.url.replace(/\/+$/, "");
    this.doFetch = cfg.fetch ?? fetch;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.doFetch(`${this.base}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.cfg.token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) {
      const msg = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
      throw new TymoError(res.status, msg);
    }
    return data as T;
  }

  search(params: { q?: string; view?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params))
      if (v !== undefined && v !== "") qs.set(k, String(v));
    return this.request<{ items: SaveSummary[]; total: number; hasMore: boolean }>(
      "GET",
      `/saves?${qs}`,
    );
  }

  get(id: string) {
    return this.request<SaveSummary & { text: string | null; aiSummary: string | null }>(
      "GET",
      `/saves/${encodeURIComponent(id)}`,
    );
  }

  related(id: string) {
    return this.request<{ items: SaveSummary[] }>(
      "GET",
      `/saves/${encodeURIComponent(id)}/related`,
    );
  }

  create(input: Record<string, unknown>) {
    return this.request<{ id: string; duplicate: boolean }>("POST", "/saves", {
      ...input,
      captureMethod: "extension",
    });
  }

  update(id: string, input: Record<string, unknown>) {
    return this.request<SaveSummary>("PATCH", `/saves/${encodeURIComponent(id)}`, input);
  }

  collections() {
    return this.request<{ collections: { id: string; name: string; icon: string | null }[] }>(
      "GET",
      "/collections",
    );
  }

  tags() {
    return this.request<{ tags: string[] }>("GET", "/tags");
  }
}
