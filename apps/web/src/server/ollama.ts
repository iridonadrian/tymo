/**
 * One-click local AI: checks whether Ollama is running, lists its models and downloads a
 * model with progress, so nobody needs a terminal. Talks only to the Ollama address in the
 * AI settings (default 127.0.0.1:11434), never to an address sent by the browser.
 */
import { getAiSettings } from "./settings";
import { OLLAMA_BASE } from "./ai";
import { MODEL_NAME } from "../lib/ai-models";
import { unloadModel } from "./ollama-idle";

export { MODEL_NAME };

async function root(): Promise<string> {
  const ai = await getAiSettings();
  const base = (ai.provider === "ollama" && ai.baseUrl ? ai.baseUrl : OLLAMA_BASE).replace(
    /\/+$/,
    "",
  );
  return base.replace(/\/v1$/, "");
}

export interface PullState {
  model: string;
  status: string;
  completed: number;
  total: number;
  done: boolean;
  error: string | null;
}

// One download at a time, kept across requests in this server process.
const g = globalThis as unknown as { __tymoPull?: { state: PullState; abort: AbortController } };

export interface OllamaStatus {
  running: boolean;
  models: { name: string; size: number }[];
  /** Models in memory right now, with how much memory each takes. */
  loaded: { name: string; size: number }[];
  pull: PullState | null;
}

const named = (list: { name?: unknown; size?: unknown }[] | undefined) =>
  (list ?? [])
    .filter((m): m is { name: string; size: number } => typeof m.name === "string")
    .map((m) => ({ name: m.name, size: Number(m.size) || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));

export async function ollamaStatus(): Promise<OllamaStatus> {
  const pull = g.__tymoPull?.state ?? null;
  const off: OllamaStatus = { running: false, models: [], loaded: [], pull };
  try {
    const base = await root();
    const get = (path: string) =>
      fetch(`${base}${path}`, { signal: AbortSignal.timeout(3000) }).then((r) =>
        r.ok ? (r.json() as Promise<{ models?: { name?: unknown; size?: unknown }[] }>) : null,
      );
    const [tags, ps] = await Promise.all([get("/api/tags"), get("/api/ps").catch(() => null)]);
    if (!tags) return off;
    return { running: true, models: named(tags.models), loaded: named(ps?.models), pull };
  } catch {
    return off;
  }
}

/** Starts downloading a model in the background; progress comes from `ollamaStatus().pull`. */
export async function startPull(model: string): Promise<void> {
  if (!MODEL_NAME.test(model)) throw new Error("That isn't a valid model name.");
  const current = g.__tymoPull;
  if (current && !current.state.done) {
    if (current.state.model === model) return;
    throw new Error(`Already downloading ${current.state.model}. Wait for it or cancel it.`);
  }
  const state: PullState = {
    model,
    status: "starting",
    completed: 0,
    total: 0,
    done: false,
    error: null,
  };
  const abort = new AbortController();
  g.__tymoPull = { state, abort };
  const url = `${await root()}/api/pull`;

  void (async () => {
    const layers = new Map<string, { total: number; completed: number }>();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, stream: true }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Ollama returned ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as {
            status?: string;
            error?: string;
            digest?: string;
            total?: number;
            completed?: number;
          };
          if (ev.error) throw new Error(ev.error);
          if (ev.status) state.status = ev.status;
          if (ev.digest && ev.total) {
            layers.set(ev.digest, { total: ev.total, completed: ev.completed ?? 0 });
            state.total = [...layers.values()].reduce((n, l) => n + l.total, 0);
            state.completed = [...layers.values()].reduce((n, l) => n + l.completed, 0);
          }
          if (ev.status === "success") state.done = true;
        }
      }
      if (!state.done) throw new Error("The download stopped before it finished.");
    } catch (err) {
      state.error = abort.signal.aborted
        ? "Cancelled"
        : err instanceof Error
          ? err.message.slice(0, 200)
          : "Download failed";
      state.done = true;
    }
  })();
}

/** Unloads every model Ollama holds in memory right now. */
export async function unloadAll(): Promise<number> {
  const { loaded } = await ollamaStatus();
  const base = await root();
  const done = await Promise.all(loaded.map((m) => unloadModel(base, m.name)));
  return done.filter(Boolean).length;
}

export function cancelPull(): void {
  const current = g.__tymoPull;
  if (current && !current.state.done) current.abort.abort();
}
