"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, KeyRound, Loader2, Trash2, Upload } from "lucide-react";
import {
  clearAiKeyAction,
  createTokenAction,
  importAction,
  indexEmbeddingsAction,
  logoutAction,
  revokeTokenAction,
  saveAiSettingsAction,
  saveArchiveSettingsAction,
  saveBackupSettingsAction,
  saveLinkCheckSettingsAction,
  checkLinksNowAction,
  backupNowAction,
  testAiAction,
} from "@/server/actions";
import {
  changeSyncPassphraseAction,
  disableSyncAction,
  disconnectAppAction,
  enableSyncAction,
  syncNowAction,
} from "@/server/actions";
import { useApp } from "./app-context";
import { Button, Time } from "./ui";
import { cn, formatBytes } from "@/lib/format";
import { applyAccent, applyTheme, type ThemePref } from "@/lib/theme";
import { ACCENT_PRESETS, DEFAULT_ACCENT } from "@/lib/accent";

export function ExtensionTokens({
  tokens,
  origin,
}: {
  tokens: {
    id: string;
    name: string;
    prefix: string;
    createdAt: number;
    lastUsedAt: number | null;
  }[];
  origin: string;
}) {
  const [created, setCreated] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast } = useApp();
  return (
    <div className="space-y-4">
      <ol className="list-inside list-decimal space-y-1 text-sm text-fg-2">
        <li>Install the extension (see README → Browser extension).</li>
        <li>
          Open its options and enter server URL{" "}
          <code className="rounded bg-surface-2 px-1 font-mono text-xs text-fg">{origin}</code>
        </li>
        <li>Create a token below and paste it there.</li>
      </ol>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await createTokenAction(name || "Browser extension");
            if (!res.ok) return toast(res.error, { tone: "error" });
            setCreated(res.data.token);
            setName("");
            router.refresh();
          });
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name (e.g. Firefox laptop)"
          aria-label="Token name"
          className="input h-8"
        />
        <Button type="submit" variant="primary" disabled={pending}>
          <KeyRound size={14} /> Create token
        </Button>
      </form>
      {created && (
        <div className="rounded-lg border border-accent/40 bg-accent-soft p-3">
          <p className="mb-2 text-xs text-fg-2">Copy this token now — it won’t be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-bg px-2 py-1.5 font-mono text-xs whitespace-nowrap">
              {created}
            </code>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(created);
                toast("Token copied");
              }}
            >
              <Copy size={12} /> Copy
            </Button>
          </div>
        </div>
      )}
      {tokens.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <KeyRound size={14} className="text-muted" />
              <span className="flex-1 truncate">{t.name}</span>
              <code className="font-mono text-2xs text-muted">{t.prefix}…</code>
              <span className="font-mono text-2xs text-muted">
                {t.lastUsedAt ? (
                  <>
                    USED <Time ts={t.lastUsedAt} />
                  </>
                ) : (
                  "NEVER USED"
                )}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="hover:text-danger"
                onClick={() => {
                  if (!confirm(`Revoke “${t.name}”? The extension using it will stop working.`))
                    return;
                  start(async () => {
                    await revokeTokenAction(t.id);
                    router.refresh();
                  });
                }}
              >
                <Trash2 size={12} /> Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ImportForm() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useApp();
  return (
    <form
      className="flex flex-wrap items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await importAction(fd);
          if (!res.ok) return toast(res.error, { tone: "error" });
          const r = res.data;
          setResult(
            `${r.format ? r.format + ": " : ""}imported ${r.imported} · ${r.duplicates} already saved · ${r.skipped} skipped · ${r.collections} collections`,
          );
          toast(`Imported ${r.imported} saves`, { tone: "success" });
          router.refresh();
        });
      }}
    >
      <input
        type="file"
        name="file"
        required
        accept=".html,.htm,.json,.csv,text/html,application/json,text/csv"
        aria-label="Bookmarks file"
        className="text-sm text-fg-2 file:mr-3 file:h-8 file:rounded-lg file:border file:border-border file:bg-surface-2 file:px-3 file:text-sm file:text-fg hover:file:border-border-strong"
      />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Import
      </Button>
      {result && (
        <p className="flex w-full items-center gap-1.5 font-mono text-2xs text-success">
          <Check size={12} /> {result}
        </p>
      )}
    </form>
  );
}

export function ExportLinks() {
  const formats = [
    ["json", "JSON", "Everything, re-importable"],
    ["csv", "CSV", "Spreadsheets"],
    ["html", "HTML bookmarks", "Any browser"],
    ["md", "Markdown", "Notes apps"],
  ] as const;
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      {formats.map(([f, label, hint]) => (
        <a
          key={f}
          href={`/export?format=${f}`}
          className="rounded-lg border border-border bg-surface-2/50 px-3 py-2.5 transition-colors hover:border-border-strong"
        >
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Download size={13} /> {label}
          </span>
          <span className="font-mono text-2xs text-muted">{hint}</span>
        </a>
      ))}
    </div>
  );
}

type AiPublic = {
  provider: "none" | "openai" | "ollama" | "anthropic" | "gemini";
  baseUrl: string;
  model: string;
  autoSuggest: boolean;
  semanticSearch: boolean;
  embeddingModel: string;
  embeddingBaseUrl: string;
  ocr: boolean;
  apiKeyHint: string | null;
};

type EmbeddingStatus = {
  enabled: boolean;
  model: string | null;
  total: number;
  indexed: number;
  queued: number;
  lastError: string | null;
};

export function AiSettingsForm({
  initial,
  embeddings,
}: {
  initial: AiPublic;
  embeddings: EmbeddingStatus;
}) {
  const [s, setS] = useState(initial);
  const [key, setKey] = useState("");
  const [pending, start] = useTransition();
  const [testing, setTesting] = useState(false);
  const router = useRouter();
  const { toast } = useApp();
  const placeholders = {
    openai: { base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    ollama: {
      base: "http://127.0.0.1:11434/v1  (Docker: http://host.docker.internal:11434/v1)",
      model: "llama3.2  ·  for images: qwen2.5vl or llama3.2-vision",
    },
    anthropic: { base: "https://api.anthropic.com", model: "claude-haiku-4-5" },
    gemini: { base: "https://generativelanguage.googleapis.com", model: "gemini-2.5-flash" },
    none: { base: "", model: "" },
  }[s.provider];

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveAiSettingsAction({
            provider: s.provider,
            baseUrl: s.baseUrl,
            model: s.model,
            autoSuggest: s.autoSuggest,
            semanticSearch: s.semanticSearch,
            embeddingModel: s.embeddingModel,
            embeddingBaseUrl: s.embeddingBaseUrl,
            ocr: s.ocr,
            apiKey: key || undefined,
          });
          if (!res.ok) return toast(res.error, { tone: "error" });
          setKey("");
          toast("AI settings saved", { tone: "success" });
          router.refresh();
        });
      }}
    >
      <label className="block">
        <span className="eyebrow mb-1 block">Provider</span>
        <select
          value={s.provider}
          onChange={(e) => setS({ ...s, provider: e.target.value as AiPublic["provider"] })}
          className="input h-8 py-0"
        >
          <option value="none">Disabled</option>
          <option value="ollama">Ollama (runs on your computer, nothing leaves it)</option>
          <option value="openai">OpenAI-compatible (OpenAI, LM Studio, OpenRouter…)</option>
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Google Gemini</option>
        </select>
      </label>
      {s.provider !== "none" && (
        <>
          <label className="block">
            <span className="eyebrow mb-1 block">Base URL (optional)</span>
            <input
              value={s.baseUrl}
              onChange={(e) => setS({ ...s, baseUrl: e.target.value })}
              placeholder={placeholders.base}
              className="input font-mono text-xs"
            />
          </label>
          <label className="block">
            <span className="eyebrow mb-1 block">Model</span>
            <input
              value={s.model}
              onChange={(e) => setS({ ...s, model: e.target.value })}
              placeholder={placeholders.model}
              className="input font-mono text-xs"
            />
          </label>
          {s.provider === "ollama" && (
            <p className="text-xs leading-relaxed text-muted">
              Install Ollama from ollama.com, then run{" "}
              <code className="font-mono text-fg-2">ollama pull llama3.2</code> (and{" "}
              <code className="font-mono text-fg-2">ollama pull nomic-embed-text</code> for semantic
              search). Everything stays on your machine; no key needed.
            </p>
          )}
          {(s.provider !== "ollama" || s.apiKeyHint) && (
            <label className="block">
              <span className="eyebrow mb-1 block">
                API key{" "}
                {s.apiKeyHint && <span className="normal-case">(saved: {s.apiKeyHint})</span>}
              </span>
              <div className="flex gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={s.apiKeyHint ? "Leave blank to keep" : "Paste your API key"}
                  className="input font-mono text-xs"
                />
                {s.apiKeyHint && (
                  <Button
                    onClick={() =>
                      start(async () => {
                        await clearAiKeyAction();
                        setS({ ...s, apiKeyHint: null });
                      })
                    }
                  >
                    Clear
                  </Button>
                )}
              </div>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-fg-2">
            <input
              type="checkbox"
              checked={s.autoSuggest}
              onChange={(e) => setS({ ...s, autoSuggest: e.target.checked })}
              className="accent-accent"
            />
            Automatically suggest title, tags and collection for new saves (still requires your
            review)
          </label>
          <label className="flex items-center gap-2 text-sm text-fg-2">
            <input
              type="checkbox"
              checked={s.ocr}
              onChange={(e) => setS({ ...s, ocr: e.target.checked })}
              className="accent-accent"
            />
            Understand new images, screenshots and product photos: describe what they show and read
            their text, so you can search for “sneakers” or “mountain” (sends the image; needs a
            vision-capable model)
          </label>
          <div className="space-y-3 rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm text-fg-2">
              <input
                type="checkbox"
                checked={s.semanticSearch}
                onChange={(e) => setS({ ...s, semanticSearch: e.target.checked })}
                className="accent-accent"
              />
              Semantic search — find saves by meaning, show related saves and near-duplicates
            </label>
            {s.semanticSearch && (
              <>
                <p className="text-xs text-muted">
                  Each save’s title, description, tags, notes and up to 2,500 characters of text are
                  sent to the embeddings endpoint.
                  {s.provider === "anthropic" &&
                    " Anthropic has no embeddings API: set an OpenAI-compatible endpoint below (e.g. Ollama)."}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="eyebrow mb-1 block">Embedding model</span>
                    <input
                      value={s.embeddingModel}
                      onChange={(e) => setS({ ...s, embeddingModel: e.target.value })}
                      placeholder={
                        {
                          openai: "text-embedding-3-small",
                          ollama: "nomic-embed-text",
                          anthropic: "nomic-embed-text",
                          gemini: "gemini-embedding-001",
                        }[s.provider]
                      }
                      className="input font-mono text-xs"
                    />
                  </label>
                  <label className="block">
                    <span className="eyebrow mb-1 block">
                      Embeddings URL {s.provider === "anthropic" ? "(required)" : "(optional)"}
                    </span>
                    <input
                      value={s.embeddingBaseUrl}
                      onChange={(e) => setS({ ...s, embeddingBaseUrl: e.target.value })}
                      placeholder="http://127.0.0.1:11434/v1"
                      className="input font-mono text-xs"
                    />
                  </label>
                </div>
                {initial.semanticSearch && <EmbeddingIndex status={embeddings} />}
              </>
            )}
          </div>
        </>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          Save
        </Button>
        {initial.provider !== "none" && (
          <Button
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              const res = await testAiAction();
              setTesting(false);
              toast(res.ok ? `Connected: ${res.data.slice(0, 80)}` : res.error, {
                tone: res.ok ? "success" : "error",
              });
            }}
          >
            {testing && <Loader2 size={13} className="animate-spin" />} Test connection
          </Button>
        )}
      </div>
    </form>
  );
}

function EmbeddingIndex({ status }: { status: EmbeddingStatus }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast } = useApp();
  const busy = status.queued > 0;
  // Refresh the counters while the background indexer works.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [busy, router]);
  if (!status.enabled) {
    return (
      <p className="font-mono text-2xs text-warn">
        Not available with this configuration — set an embeddings URL.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-2xs text-fg-2">
      <span>
        {status.indexed.toLocaleString("en-US")} / {status.total.toLocaleString("en-US")} INDEXED
        {busy && ` · ${status.queued} QUEUED`}
      </span>
      {status.lastError && <span className="text-danger">{status.lastError}</span>}
      {status.indexed < status.total && (
        <Button
          size="sm"
          disabled={pending || busy}
          onClick={() =>
            start(async () => {
              const res = await indexEmbeddingsAction();
              if (!res.ok) return toast(res.error, { tone: "error" });
              toast(`Indexing ${res.data} saves in the background`);
              router.refresh();
            })
          }
        >
          {(pending || busy) && <Loader2 size={12} className="animate-spin" />} Index library
        </Button>
      )}
    </div>
  );
}

export function ArchiveSettingsForm({ auto }: { auto: boolean }) {
  const [on, setOn] = useState(auto);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast } = useApp();
  return (
    <label className="flex items-center gap-2 text-sm text-fg-2">
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          start(async () => {
            const res = await saveArchiveSettingsAction({ auto: next });
            if (!res.ok) {
              setOn(!next);
              return toast(res.error, { tone: "error" });
            }
            toast(next ? "New pages will be archived" : "Automatic archiving off");
            router.refresh();
          });
        }}
        className="accent-accent"
      />
      Automatically archive every new web page after saving it
    </label>
  );
}

type StoredBackup = { name: string; size: number; createdAt: number };

export function BackupPanel({
  auto,
  keep,
  backups,
  dir,
}: {
  auto: boolean;
  keep: number;
  backups: StoredBackup[];
  dir: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [s, setS] = useState({ auto, keep });
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast } = useApp();
  const saveSettings = (next: { auto: boolean; keep: number }) => {
    setS(next);
    start(async () => {
      const res = await saveBackupSettingsAction(next);
      if (!res.ok) toast(res.error, { tone: "error" });
      router.refresh();
    });
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm text-fg-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.auto}
            disabled={pending}
            onChange={(e) => saveSettings({ ...s, auto: e.target.checked })}
            className="accent-accent"
          />
          Back up automatically every day, keep the last
        </label>
        <input
          type="number"
          min={1}
          max={90}
          value={s.keep}
          aria-label="Backups to keep"
          onChange={(e) => setS({ ...s, keep: Number(e.target.value) || 1 })}
          onBlur={() => saveSettings(s)}
          className="input h-7 w-16 py-0 font-mono text-xs"
        />
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await backupNowAction();
              if (!res.ok) return toast(res.error, { tone: "error" });
              toast("Backup written", { tone: "success" });
              router.refresh();
            })
          }
        >
          {pending && <Loader2 size={12} className="animate-spin" />} Back up now
        </Button>
      </div>
      {backups.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {backups.map((b) => (
            <li key={b.name} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1 truncate font-mono text-xs">{b.name}</span>
              <span className="font-mono text-2xs text-muted">{formatBytes(b.size)}</span>
              <Time ts={b.createdAt} />
              <a
                href={`/backup/files/${encodeURIComponent(b.name)}`}
                className="text-accent-ink hover:underline"
                aria-label={`Download ${b.name}`}
              >
                <Download size={13} />
              </a>
            </li>
          ))}
        </ul>
      )}
      {s.auto && <p className="font-mono text-2xs text-muted">Stored in {dir}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href="/backup"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          <Download size={14} /> Download full backup
        </a>
        <span className="font-mono text-2xs text-muted">
          .tar.gz · database, uploads, screenshots and archived pages
        </span>
      </div>
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const file = new FormData(e.currentTarget).get("backup");
          if (!(file instanceof File) || !file.size)
            return toast("Choose a backup file", { tone: "error" });
          if (
            !confirm(
              "Restore this backup? It replaces your entire library. Your current data is moved aside in the data folder, not deleted.",
            )
          )
            return;
          setBusy(true);
          setResult(null);
          try {
            const res = await fetch("/backup", {
              method: "POST",
              body: file,
              headers: { "content-type": "application/gzip" },
            });
            const data = (await res.json().catch(() => ({}))) as {
              error?: string;
              saves?: number;
              files?: number;
            };
            if (!res.ok) throw new Error(data.error ?? `Restore failed (${res.status})`);
            setResult(`Restored ${data.saves} saves and ${data.files} files.`);
            toast("Backup restored", { tone: "success" });
            setTimeout(() => {
              router.push("/");
              router.refresh();
            }, 1200);
          } catch (err) {
            toast((err as Error).message, { tone: "error" });
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          type="file"
          name="backup"
          accept=".gz,.tgz,application/gzip"
          aria-label="Backup file"
          className="text-sm text-fg-2 file:mr-3 file:h-8 file:rounded-lg file:border file:border-border file:bg-surface-2 file:px-3 file:text-sm file:text-fg hover:file:border-border-strong"
        />
        <Button type="submit" variant="danger" disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Restore
        </Button>
        {result && (
          <p className="flex w-full items-center gap-1.5 font-mono text-2xs text-success">
            <Check size={12} /> {result}
          </p>
        )}
      </form>
    </div>
  );
}

export function LinkCheckForm({ auto, broken }: { auto: boolean; broken: number }) {
  const [on, setOn] = useState(auto);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast } = useApp();
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-fg-2">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            start(async () => {
              const res = await saveLinkCheckSettingsAction({ auto: next });
              if (!res.ok) toast(res.error, { tone: "error" });
              router.refresh();
            });
          }}
          className="accent-accent"
        />
        Check saved links for rot in the background (each link about once a month)
      </label>
      <div className="flex flex-wrap items-center gap-3 font-mono text-2xs text-fg-2">
        {broken > 0 ? (
          <a href="/saves?q=is:broken" className="text-danger hover:underline">
            {broken} BROKEN LINK{broken === 1 ? "" : "S"} →
          </a>
        ) : (
          <span>NO BROKEN LINKS FOUND</span>
        )}
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await checkLinksNowAction();
              if (!res.ok) return toast(res.error, { tone: "error" });
              toast(
                res.data.checked
                  ? `Checked ${res.data.checked} links · ${res.data.broken} broken`
                  : "All links were checked recently",
              );
              router.refresh();
            })
          }
        >
          {pending && <Loader2 size={12} className="animate-spin" />} Check links now
        </Button>
      </div>
    </div>
  );
}

export function ThemePicker({ initial }: { initial: ThemePref }) {
  const [pref, setPref] = useState<ThemePref>(initial);
  const options: [ThemePref, string][] = [
    ["system", "System"],
    ["light", "Light"],
    ["dark", "Dark"],
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5"
    >
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          onClick={() => {
            setPref(value);
            applyTheme(value);
          }}
          className={
            pref === value
              ? "h-7 rounded-md bg-surface px-3 text-sm text-fg shadow-sm"
              : "h-7 rounded-md px-3 text-sm text-fg-2 hover:text-fg"
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function AccentPicker({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial ?? DEFAULT_ACCENT);
  const pick = (hex: string | null) => {
    setValue(hex ?? DEFAULT_ACCENT);
    applyAccent(hex);
  };
  const isPreset = ACCENT_PRESETS.some((p) => p.hex === value);
  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Accent colour"
        className="flex flex-wrap items-center gap-2"
      >
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.hex}
            type="button"
            role="radio"
            aria-checked={value === p.hex}
            aria-label={p.name}
            title={p.name}
            onClick={() => pick(p.hex === DEFAULT_ACCENT ? null : p.hex)}
            className={cn(
              "size-7 rounded-full border border-border transition-transform hover:scale-110",
              value === p.hex && "ring-2 ring-fg ring-offset-2 ring-offset-surface",
            )}
            style={{ background: p.hex }}
          />
        ))}
        <label
          title="Custom colour"
          className={cn(
            "relative flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-fg-2 hover:border-border-strong",
            !isPreset && "ring-2 ring-fg ring-offset-2 ring-offset-surface",
          )}
        >
          <span
            className="size-3.5 rounded-full border border-border"
            style={{ background: value }}
          />
          Custom
          <input
            type="color"
            value={value}
            onChange={(e) => pick(e.target.value)}
            aria-label="Custom accent colour"
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" size="sm" tabIndex={-1}>
          Primary action
        </Button>
        <span className="text-sm text-accent-ink">Accent text</span>
        <span className="font-mono text-2xs text-muted">{value.toUpperCase()}</span>
      </div>
    </div>
  );
}

/** Bookmarklet for browsers without the extension (Safari, mobile browsers, locked-down PCs). */
export interface ConnectedApp {
  id: string;
  name: string;
  host: string;
  canWrite: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

/** The remote MCP connector URL, setup steps for claude.ai, and apps connected with OAuth. */
export function McpConnector({
  url,
  passwordSet,
  apps,
}: {
  url: string;
  passwordSet: boolean;
  apps: ConnectedApp[];
}) {
  const { toast } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const https = url.startsWith("https://");
  return (
    <div className="space-y-4">
      <ClaudeCodeConnect url={url} />
      <div>
        <div className="eyebrow mb-1.5">claude.ai (web and phone)</div>
        {!passwordSet || !https ? (
          <p className="rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs leading-relaxed text-fg-2">
            claude.ai connects from Anthropic&rsquo;s servers, so it can&rsquo;t reach a Tymo that
            only runs on this computer ({url}). It needs Tymo reachable over HTTPS
            {passwordSet ? "" : " with a password (TYMO_PASSWORD), so you can approve apps"}: see
            &ldquo;Before exposing Tymo&rdquo; in the README. Claude Code on this computer works
            right away with the button above.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded bg-bg px-2 py-1.5 font-mono text-xs whitespace-nowrap text-fg">
                {url}
              </code>
              <Button
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(url);
                  toast("Connector URL copied");
                }}
              >
                <Copy size={12} /> Copy
              </Button>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-2">
              <li>
                In claude.ai open{" "}
                <strong className="font-medium text-fg">Settings → Connectors</strong> and choose{" "}
                <strong className="font-medium text-fg">Add custom connector</strong>.
              </li>
              <li>Name it “Tymo”, paste the URL above, and click Add, then Connect.</li>
              <li>
                Approve the request on the Tymo page that opens. Choose read-only if you prefer.
              </li>
            </ol>
          </div>
        )}
      </div>
      <div>
        <div className="eyebrow mb-1.5">Connected apps</div>
        {apps.length === 0 ? (
          <p className="text-xs text-muted">No apps connected yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {apps.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{a.name}</div>
                  <div className="font-mono text-2xs text-muted">
                    {a.host} · {a.canWrite ? "read & write" : "read-only"} · connected{" "}
                    <Time ts={a.createdAt} />
                    {a.lastUsedAt ? (
                      <>
                        {" "}
                        · used <Time ts={a.lastUsedAt} />
                      </>
                    ) : null}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await disconnectAppAction(a.id);
                      if (!res.ok) return toast(res.error, { tone: "error" });
                      toast(`${a.name} disconnected`, { tone: "success" });
                      router.refresh();
                    })
                  }
                >
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Bookmarklet({ origin }: { origin: string }) {
  const { toast } = useApp();
  const code =
    "javascript:(()=>{window.open(" +
    JSON.stringify(`${origin}/share?popup=1&url=`) +
    "+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)," +
    "'tymo','width=640,height=600')})()";
  return (
    <div className="space-y-2">
      <p className="text-sm text-fg-2">
        No extension? Create a bookmark named “Save to Tymo” and paste this as its URL. Clicking it
        opens quick save for the current page.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded bg-bg px-2 py-1.5 font-mono text-2xs whitespace-nowrap text-fg-2">
          {code}
        </code>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            toast("Bookmarklet copied");
          }}
        >
          <Copy size={12} /> Copy
        </Button>
      </div>
    </div>
  );
}

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <Button type="submit">Sign out</Button>
    </form>
  );
}

export interface SyncPanelStatus {
  enabled: boolean;
  folder: string | null;
  defaultFolder: string | null;
  devices: number;
  others: { lastChangeAt: number | null }[];
  lastSyncAt: number | null;
  lastError: string | null;
  waiting: number;
  queued: number;
  issue: "passphrase" | "gone" | null;
}

type OffMode = "keep" | "remove" | "erase";

const OFF_CHOICES: { mode: OffMode; title: string; detail: string }[] = [
  {
    mode: "keep",
    title: "Just this computer",
    detail: "Stop syncing here. Your other computers keep syncing with each other.",
  },
  {
    mode: "remove",
    title: "Remove this computer from sync",
    detail:
      "Also takes this computer's changes out of the sync folder. What the others already received stays with them.",
  },
  {
    mode: "erase",
    title: "Delete the synced library from the folder",
    detail:
      "Every computer stops syncing and keeps its own library. Use this to start over, or to stop using the cloud drive.",
  },
];

/** Settings → Sync: one library on several computers through a shared, encrypted folder. */
export function SyncPanel({ status }: { status: SyncPanelStatus }) {
  const [panel, setPanel] = useState<null | "passphrase" | "off">(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast } = useApp();

  useEffect(() => {
    if (!status.enabled) return;
    const t = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(t);
  }, [status.enabled, router]);

  if (!status.enabled) return <SyncSetupForm initialFolder={status.defaultFolder ?? ""} />;

  if (status.issue === "passphrase")
    return (
      <div className="space-y-3 text-sm">
        <p className="text-warn">
          The passphrase was changed on another computer. Enter the new passphrase to keep syncing;
          this computer&rsquo;s library is kept and merged back in.
        </p>
        <SyncSetupForm initialFolder={status.folder ?? ""} rejoin />
        <OffChooser pending={pending} start={start} />
      </div>
    );

  if (status.issue === "gone")
    return (
      <div className="space-y-3 text-sm">
        <p className="text-warn">
          The synced library was removed from the sync folder (on another computer or in the cloud
          drive). This computer&rsquo;s library is untouched.
        </p>
        <p className="text-xs text-fg-2">
          Start a new synced library from this computer, or turn sync off.
        </p>
        <SyncSetupForm initialFolder={status.folder ?? ""} />
        <OffChooser pending={pending} start={start} />
      </div>
    );

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-fg">
          <span
            className={cn("size-2 rounded-full", status.lastError ? "bg-warn" : "bg-success")}
            aria-hidden
          />
          {status.lastError ? "Sync paused" : "Sync is on"}
        </span>
        <span className="text-fg-2">
          {status.others.length === 0
            ? "Only this computer so far"
            : `This computer and ${status.others.length} ${status.others.length === 1 ? "other" : "others"}`}
          {status.others[0]?.lastChangeAt && (
            <>
              {" "}
              (last change from another computer <Time ts={status.others[0].lastChangeAt} />)
            </>
          )}
        </span>
        {status.lastSyncAt && (
          <span className="text-fg-2">
            last synced <Time ts={status.lastSyncAt} />
          </span>
        )}
        {status.waiting > 0 && (
          <span className="text-fg-2">{status.waiting} changes waiting for the cloud drive</span>
        )}
      </div>
      {status.lastError && <p className="text-xs text-warn">{status.lastError}</p>}
      {status.others.length === 0 && !status.lastError && (
        <p className="text-xs text-muted">
          Other computers appear here once the cloud drive has delivered their changes, which can
          take a few minutes with iCloud Drive.
        </p>
      )}
      <p className="font-mono text-xs break-all text-muted">{status.folder}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await syncNowAction();
              if (!res.ok) toast(res.error, { tone: "error" });
              router.refresh();
            })
          }
        >
          {pending && <Loader2 size={12} className="animate-spin" />} Sync now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={panel === "passphrase"}
          onClick={() => setPanel(panel === "passphrase" ? null : "passphrase")}
        >
          Change passphrase
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={panel === "off"}
          onClick={() => setPanel(panel === "off" ? null : "off")}
        >
          Turn off…
        </Button>
      </div>
      {panel === "passphrase" && <ChangePassphraseForm onDone={() => setPanel(null)} />}
      {panel === "off" && <OffChooser pending={pending} start={start} open />}
    </div>
  );
}

function SyncSetupForm({
  initialFolder,
  rejoin = false,
}: {
  initialFolder: string;
  rejoin?: boolean;
}) {
  const [folder, setFolder] = useState(initialFolder);
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast } = useApp();
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (!rejoin && pass !== again)
          return toast("The passphrases don't match", { tone: "error" });
        start(async () => {
          const res = await enableSyncAction({ folder, passphrase: pass });
          if (!res.ok) return toast(res.error, { tone: "error" });
          setPass("");
          setAgain("");
          toast(
            res.data.joined
              ? "Joined your library: everything will be merged in a moment"
              : "Sync is on. Now turn it on on your other computers with the same folder and passphrase",
            { tone: "success" },
          );
          router.refresh();
        });
      }}
    >
      {!rejoin && (
        <label className="block space-y-1">
          <span className="text-xs text-fg-2">Sync folder</span>
          <input
            className="input h-8 font-mono text-xs"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="~/Library/Mobile Documents/com~apple~CloudDocs/Tymo Sync"
            required
            spellCheck={false}
          />
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs text-fg-2">{rejoin ? "New passphrase" : "Passphrase"}</span>
          <input
            className="input h-8"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            minLength={8}
            autoComplete={rejoin ? "current-password" : "new-password"}
            required
          />
        </label>
        {!rejoin && (
          <label className="block space-y-1">
            <span className="text-xs text-fg-2">Passphrase again</span>
            <input
              className="input h-8"
              type="password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              minLength={8}
              autoComplete="new-password"
              required
            />
          </label>
        )}
      </div>
      {!rejoin && (
        <p className="text-xs text-muted">
          Use the same folder and passphrase on every computer. The passphrase encrypts everything
          in the folder and can&rsquo;t be recovered, so keep it somewhere safe. On a second
          computer, wait until the folder shows up in your cloud drive before turning sync on, so it
          joins instead of starting its own library.
        </p>
      )}
      <Button size="sm" type="submit" disabled={pending}>
        {pending && <Loader2 size={12} className="animate-spin" />}{" "}
        {rejoin ? "Continue syncing" : "Turn on sync"}
      </Button>
    </form>
  );
}

function ChangePassphraseForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast } = useApp();
  return (
    <form
      className="space-y-3 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (next !== again) return toast("The new passphrases don't match", { tone: "error" });
        start(async () => {
          const res = await changeSyncPassphraseAction({ current, next });
          if (!res.ok) return toast(res.error, { tone: "error" });
          toast(
            "Passphrase changed. On your other computers, enter the new one in Settings → Sync.",
            {
              tone: "success",
            },
          );
          onDone();
          router.refresh();
        });
      }}
    >
      <p className="text-xs text-fg-2">
        The synced library is re-encrypted from this computer. Your other computers will ask for the
        new passphrase and then send their changes again, so nothing is lost.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["Current passphrase", current, setCurrent, "current-password"],
            ["New passphrase", next, setNext, "new-password"],
            ["New passphrase again", again, setAgain, "new-password"],
          ] as const
        ).map(([label, value, set, ac]) => (
          <label key={label} className="block space-y-1">
            <span className="text-xs text-fg-2">{label}</span>
            <input
              className="input h-8"
              type="password"
              value={value}
              onChange={(e) => set(e.target.value)}
              minLength={label === "Current passphrase" ? 1 : 8}
              autoComplete={ac}
              required
            />
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={pending}>
          {pending && <Loader2 size={12} className="animate-spin" />} Change passphrase
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function OffChooser({
  pending,
  start,
  open = false,
}: {
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
  open?: boolean;
}) {
  const [shown, setShown] = useState(open);
  const [mode, setMode] = useState<OffMode>("keep");
  const router = useRouter();
  const { toast } = useApp();
  if (!shown)
    return (
      <Button size="sm" variant="ghost" onClick={() => setShown(true)}>
        Turn off…
      </Button>
    );
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-xs text-fg-2">Your library stays on this computer in every case.</p>
      <div className="space-y-2" role="radiogroup" aria-label="How to turn sync off">
        {OFF_CHOICES.map((c) => (
          <label key={c.mode} className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="sync-off"
              className="mt-1 accent-accent"
              checked={mode === c.mode}
              onChange={() => setMode(c.mode)}
            />
            <span>
              <span className={cn("block text-sm", c.mode === "erase" ? "text-danger" : "text-fg")}>
                {c.title}
              </span>
              <span className="block text-xs text-fg-2">{c.detail}</span>
            </span>
          </label>
        ))}
      </div>
      <Button
        size="sm"
        variant={mode === "erase" ? "danger" : "secondary"}
        disabled={pending}
        onClick={() => {
          if (
            mode === "erase" &&
            !confirm(
              "Delete the synced library from the sync folder? Every computer stops syncing.",
            )
          )
            return;
          start(async () => {
            const res = await disableSyncAction(mode);
            if (!res.ok) return toast(res.error, { tone: "error" });
            toast("Sync is off on this computer", { tone: "success" });
            router.refresh();
          });
        }}
      >
        {pending && <Loader2 size={12} className="animate-spin" />} Turn off sync
      </Button>
    </div>
  );
}

/**
 * Claude Code runs on this computer, so it can use the local /mcp endpoint with an API
 * token. One click creates the token and the exact command (removing any older entry first,
 * which would otherwise shadow the new one).
 */
function ClaudeCodeConnect({ url }: { url: string }) {
  const [command, setCommand] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { toast } = useApp();
  const router = useRouter();
  return (
    <div>
      <div className="eyebrow mb-1.5">Claude Code (on this computer)</div>
      {!command ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await createTokenAction("Claude Code");
                if (!res.ok) return toast(res.error, { tone: "error" });
                const cmd =
                  "claude mcp remove tymo -s local 2>/dev/null; claude mcp remove tymo -s user 2>/dev/null; " +
                  `claude mcp add --scope user --transport http tymo ${url} --header "Authorization: Bearer ${res.data.token}"`;
                setCommand(cmd);
                void navigator.clipboard.writeText(cmd).then(
                  () => toast("Command copied: paste it in Terminal"),
                  () => {},
                );
                router.refresh();
              })
            }
          >
            {pending && <Loader2 size={12} className="animate-spin" />} Connect Claude Code
          </Button>
          <span className="text-xs text-fg-2">
            Creates a token and copies the command to paste in Terminal.
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-fg-2">
            Paste this in Terminal (it&rsquo;s already copied), then run{" "}
            <code className="font-mono">claude mcp list</code>: Tymo should show{" "}
            <span className="text-fg">Connected</span>. Keep the Tymo app open while you use it. The
            command contains your token, so don&rsquo;t share it.
          </p>
          <div className="flex items-start gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-bg px-2 py-1.5 font-mono text-xs break-all text-fg">
              {command}
            </code>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(command);
                toast("Command copied");
              }}
            >
              <Copy size={12} /> Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
