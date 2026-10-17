/**
 * Frees memory after local AI work: Ollama keeps a model loaded (often several GB) for a
 * while after each request. Tymo notes every model it used and, once nothing has run for
 * the chosen idle time, asks Ollama to unload them. Batched jobs keep the model loaded
 * because every request restarts the countdown.
 */

/** "http://127.0.0.1:11434/v1" → "http://127.0.0.1:11434". */
export function ollamaRoot(base: string): string {
  return base.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Ollama's standard port, used to recognise it when it serves embeddings for another provider. */
export function looksLikeOllama(base: string): boolean {
  try {
    return new URL(base).port === "11434";
  } catch {
    return false;
  }
}

type Idle = { models: Set<string>; timer: ReturnType<typeof setTimeout> | null };
const g = globalThis as unknown as { __tymoOllamaIdle?: Map<string, Idle> };
const state = (g.__tymoOllamaIdle ??= new Map());

/** Asks Ollama to unload one model now. Never throws. */
export async function unloadModel(root: string, model: string): Promise<boolean> {
  const post = (path: string, body: object) =>
    fetch(`${root}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    }).then((r) => r.ok);
  try {
    if (await post("/api/generate", { model, keep_alive: 0 })) return true;
    // Embedding-only models don't take /api/generate.
    return await post("/api/embed", { model, input: [], keep_alive: 0 });
  } catch {
    return false;
  }
}

/**
 * Records that `model` just ran on the Ollama at `base` and (re)starts the countdown to
 * unload it. `idleSeconds` ≤ 0 or ≥ 300 leaves it to Ollama's own five-minute default.
 */
export function noteOllamaUse(base: string, model: string, idleSeconds: number): void {
  if (idleSeconds <= 0 || idleSeconds >= 300) return;
  const root = ollamaRoot(base);
  const entry = state.get(root) ?? { models: new Set<string>(), timer: null };
  entry.models.add(model);
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    const models = [...entry.models];
    state.delete(root);
    for (const m of models) void unloadModel(root, m);
  }, idleSeconds * 1000);
  entry.timer.unref?.();
  state.set(root, entry);
}

/** For tests: whether a countdown is waiting for this Ollama. */
export function pendingUnload(base: string): string[] {
  return [...(state.get(ollamaRoot(base))?.models ?? [])];
}
