"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, ExternalLink, Loader2, X } from "lucide-react";
import {
  ollamaCancelPullAction,
  ollamaFreeMemoryAction,
  ollamaPullAction,
  ollamaStatusAction,
} from "@/server/actions";
import type { OllamaStatus } from "@/server/ollama";
import { EMBEDDING_MODEL, HOSTED_MODELS, RECOMMENDED_MODELS, isInstalled } from "@/lib/ai-models";
import { formatBytes } from "@/lib/format";
import { useApp } from "./app-context";
import { Button } from "./ui";

const OTHER = "__other__";

/** Where to get an API key for each hosted provider. */
export const KEY_PAGES: Record<string, { url: string; label: string }> = {
  anthropic: { url: "https://console.anthropic.com/settings/keys", label: "Get an Anthropic key" },
  openai: { url: "https://platform.openai.com/api-keys", label: "Get an OpenAI key" },
  gemini: { url: "https://aistudio.google.com/apikey", label: "Get a free Gemini key" },
};

/** A dropdown of good models for a hosted provider, with "Other" for any name. */
export function HostedModelPicker({
  provider,
  value,
  onChange,
}: {
  provider: "openai" | "anthropic" | "gemini";
  value: string;
  onChange: (model: string) => void;
}) {
  const presets = HOSTED_MODELS[provider];
  const current = value || presets[0]!.name;
  const known = presets.some((p) => p.name === current);
  const [other, setOther] = useState(!known);
  useEffect(() => {
    if (!value) onChange(presets[0]!.name);
  }, [value, presets, onChange]);
  return (
    <label className="block">
      <span className="eyebrow mb-1 block">Model</span>
      <select
        value={other ? OTHER : current}
        onChange={(e) => {
          if (e.target.value === OTHER) return setOther(true);
          setOther(false);
          onChange(e.target.value);
        }}
        className="input h-8 py-0"
      >
        {presets.map((p) => (
          <option key={p.name} value={p.name}>
            {p.label}
          </option>
        ))}
        <option value={OTHER}>Other model (type its name)…</option>
      </select>
      {other && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Model name"
          aria-label="Model name"
          className="input mt-2 font-mono text-xs"
        />
      )}
    </label>
  );
}

/**
 * Free, private AI with Ollama in three clicks: install Ollama, pick a model from the
 * dropdown, Download. Tymo finds Ollama on its own and shows the download progress.
 */
export function OllamaSetup({
  model,
  onChange,
  onReady,
  semanticSearch,
  idleSeconds,
  onIdleChange,
}: {
  model: string;
  onChange: (model: string) => void;
  /** Called after a download finishes so the choice can be saved right away. */
  onReady: (model: string) => void;
  semanticSearch: boolean;
  idleSeconds: number;
  onIdleChange: (seconds: number) => void;
}) {
  const { toast } = useApp();
  const [status, setStatus] = useState<OllamaStatus | null>(null);

  const refresh = useCallback(async () => {
    const res = await ollamaStatusAction();
    if (res.ok) setStatus(res.data);
    return res.ok ? res.data : null;
  }, []);

  const pulling = status?.pull && !status.pull.done ? status.pull : null;
  // Check often while downloading, now and then while waiting for Ollama to start.
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), pulling ? 1000 : status?.running ? 15000 : 4000);
    return () => clearInterval(t);
  }, [refresh, pulling, status?.running]);

  // React once when a download this page saw running comes to an end.
  const watching = useRef(false);
  useEffect(() => {
    const p = status?.pull;
    if (p && !p.done) watching.current = true;
    if (!p?.done || !watching.current) return;
    watching.current = false;
    if (p.error) toast(p.error === "Cancelled" ? "Download cancelled" : p.error, { tone: "error" });
    else if (p.model === EMBEDDING_MODEL.name)
      toast("Semantic search model is ready", { tone: "success" });
    else {
      toast(`${p.model} is ready`, { tone: "success" });
      onReady(p.model);
    }
  }, [status?.pull, toast, onReady]);

  const installed = (status?.models ?? []).filter((m) => !/embed/i.test(m.name));
  // Nothing chosen yet: a recommended model already on this computer, else the top pick.
  const chat =
    model ||
    RECOMMENDED_MODELS.find((r) => isInstalled(installed, r.name))?.name ||
    RECOMMENDED_MODELS[0].name;
  useEffect(() => {
    if (!model && status?.running) onChange(chat);
  }, [model, status?.running, chat, onChange]);

  const pull = async (name: string) => {
    const res = await ollamaPullAction(name);
    if (!res.ok) return toast(res.error, { tone: "error" });
    watching.current = true;
    void refresh();
  };

  if (!status)
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        <Loader2 size={12} className="animate-spin" /> Looking for Ollama on this computer…
      </p>
    );

  if (!status.running)
    return (
      <div className="space-y-2 rounded-lg border border-border bg-surface-2/40 p-3">
        <p className="text-sm font-medium">Step 1: install Ollama (free)</p>
        <p className="text-xs text-fg-2">
          Ollama runs AI models on your own computer, so nothing leaves it. Download it, open it
          once, and come back here: Tymo finds it on its own.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="https://ollama.com/download"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            <Download size={13} /> Download Ollama
          </a>
          <span className="flex items-center gap-1.5 text-2xs text-muted">
            <Loader2 size={11} className="animate-spin" /> Waiting for Ollama to start…
          </span>
        </div>
      </div>
    );

  const isChatInstalled = isInstalled(installed, chat);
  const rec = RECOMMENDED_MODELS.find((r) => r.name === chat);
  const notInstalledRecs = RECOMMENDED_MODELS.filter((r) => !isInstalled(installed, r.name));
  const embeddingReady = isInstalled(status.models, EMBEDDING_MODEL.name);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="eyebrow mb-1 block">Model</span>
        <select
          value={chat}
          onChange={(e) => onChange(e.target.value)}
          disabled={!!pulling}
          className="input h-8 py-0"
        >
          {installed.length > 0 && (
            <optgroup label="On this computer">
              {installed.map((m) => (
                <option key={m.name} value={m.name}>
                  {RECOMMENDED_MODELS.find((r) => isInstalled([m], r.name))?.label ?? m.name}
                  {m.size ? ` · ${formatBytes(m.size)}` : ""}
                </option>
              ))}
            </optgroup>
          )}
          {notInstalledRecs.length > 0 && (
            <optgroup label="Download">
              {notInstalledRecs.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.label} · {r.size}
                </option>
              ))}
            </optgroup>
          )}
          {!isChatInstalled && !rec && <option value={chat}>{chat}</option>}
        </select>
      </label>

      {pulling ? (
        <PullProgress pull={pulling} />
      ) : isChatInstalled ? (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <Check size={13} /> Installed. Click Save below to use it.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => pull(chat)}>
            <Download size={13} /> Download{rec ? ` (${rec.size})` : ""} and use
          </Button>
          <span className="text-2xs text-muted">
            One time only. It keeps downloading if you leave this page.
          </span>
        </div>
      )}

      {semanticSearch && !embeddingReady && !pulling && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-fg-2">
          Semantic search needs <code className="font-mono">{EMBEDDING_MODEL.name}</code>.
          <Button onClick={() => pull(EMBEDDING_MODEL.name)}>
            <Download size={13} /> Download ({EMBEDDING_MODEL.size})
          </Button>
        </div>
      )}

      <MemoryControls
        loaded={status.loaded}
        idleSeconds={idleSeconds}
        onIdleChange={onIdleChange}
        onFreed={() => void refresh()}
      />
    </div>
  );
}

const IDLE_CHOICES = [
  { value: 10, label: "10 seconds after the AI finishes" },
  { value: 60, label: "1 minute after (recommended)" },
  { value: 300, label: "5 minutes after (Ollama's default)" },
];

/** What Ollama holds in memory, when Tymo lets it go, and a button to free it now. */
function MemoryControls({
  loaded,
  idleSeconds,
  onIdleChange,
  onFreed,
}: {
  loaded: OllamaStatus["loaded"];
  idleSeconds: number;
  onIdleChange: (seconds: number) => void;
  onFreed: () => void;
}) {
  const { toast } = useApp();
  const [freeing, setFreeing] = useState(false);
  const total = loaded.reduce((n, m) => n + m.size, 0);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <label className="block">
        <span className="eyebrow mb-1 block">Free memory</span>
        <select
          value={IDLE_CHOICES.some((c) => c.value === idleSeconds) ? idleSeconds : 60}
          onChange={(e) => onIdleChange(Number(e.target.value))}
          className="input h-8 py-0"
        >
          {IDLE_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-2">
        <span>
          {loaded.length
            ? `In memory now: ${loaded.map((m) => m.name).join(", ")} · ${formatBytes(total)}`
            : "Nothing in memory right now. The model loads again in a few seconds when needed."}
        </span>
        {loaded.length > 0 && (
          <Button
            disabled={freeing}
            onClick={async () => {
              setFreeing(true);
              const res = await ollamaFreeMemoryAction();
              setFreeing(false);
              if (!res.ok) return toast(res.error, { tone: "error" });
              toast("Memory freed", { tone: "success" });
              onFreed();
            }}
          >
            {freeing && <Loader2 size={13} className="animate-spin" />} Free memory now
          </Button>
        )}
      </div>
    </div>
  );
}

function PullProgress({ pull }: { pull: NonNullable<OllamaStatus["pull"]> }) {
  const pct = pull.total ? Math.min(100, Math.round((pull.completed / pull.total) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs text-fg-2">
        <span className="flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Downloading {pull.model}
          {pull.total ? ` · ${formatBytes(pull.completed)} of ${formatBytes(pull.total)}` : "…"}
        </span>
        <button
          type="button"
          onClick={() => void ollamaCancelPullAction()}
          className="flex items-center gap-1 text-2xs text-muted hover:text-fg"
        >
          <X size={11} /> Cancel
        </button>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Downloading ${pull.model}`}
      >
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function KeyLink({ provider }: { provider: string }) {
  const k = KEY_PAGES[provider];
  if (!k) return null;
  return (
    <a
      href={k.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-2xs text-accent hover:underline"
    >
      {k.label} <ExternalLink size={10} />
    </a>
  );
}
