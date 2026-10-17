/** Model choices shown in Settings → AI (shared by the server and the browser). */

/** Models offered in Settings → AI, best first for this app's jobs. */
export const RECOMMENDED_MODELS = [
  {
    name: "qwen2.5:14b",
    size: "9 GB",
    label: "Qwen 2.5 14B: recommended, organizes bookmarks well (16 GB+ memory)",
  },
  {
    name: "qwen2.5:7b",
    size: "4.7 GB",
    label: "Qwen 2.5 7B: faster, good for 8–16 GB memory",
  },
  {
    name: "qwen2.5:32b",
    size: "20 GB",
    label: "Qwen 2.5 32B: best results, slower (32 GB+ memory)",
  },
  {
    name: "qwen2.5vl:7b",
    size: "6 GB",
    label: "Qwen 2.5 VL 7B: also understands images and screenshots",
  },
] as const;

export const EMBEDDING_MODEL = { name: "nomic-embed-text", size: "270 MB" } as const;

/** Ollama model names: letters, digits, `._-/`, optionally `:tag`. */
export const MODEL_NAME = /^[a-z0-9][a-z0-9._/-]{0,100}(:[a-z0-9._-]{1,60})?$/i;

/** True when `wanted` (e.g. "llama3.2") is among the installed names (e.g. "llama3.2:latest"). */
export function isInstalled(installed: { name: string }[], wanted: string): boolean {
  const w = wanted.includes(":") ? wanted : `${wanted}:latest`;
  return installed.some((m) => m.name === wanted || m.name === w);
}

/** Ready-made choices for hosted providers; any other model name can still be typed. */
export const HOSTED_MODELS: Record<
  "openai" | "anthropic" | "gemini",
  { name: string; label: string }[]
> = {
  anthropic: [
    { name: "claude-haiku-5-5", label: "Claude Haiku 5.5: fast and very cheap (recommended)" },
    { name: "claude-sonnet-5-5", label: "Claude Sonnet 5.5: smarter, costs more" },
    { name: "claude-opus-5-5", label: "Claude Opus 5.5: best, most expensive" },
  ],
  openai: [
    { name: "gpt-4o-mini", label: "GPT-4o mini: fast and cheap" },
    { name: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { name: "gpt-4.1", label: "GPT-4.1: smarter, costs more" },
  ],
  gemini: [
    { name: "gemini-2.5-flash", label: "Gemini 2.5 Flash: fast and cheap (recommended)" },
    { name: "gemini-2.5-pro", label: "Gemini 2.5 Pro: smarter, costs more" },
  ],
};
