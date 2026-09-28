"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookDown,
  ExternalLink,
  Highlighter,
  Loader2,
  PanelRight,
  RefreshCw,
  X,
} from "lucide-react";
import { safeHref } from "@tymo/core";
import {
  bulkAction,
  markOpenedAction,
  refreshMetadataAction,
  saveHighlightAction,
} from "@/server/actions";
import { cn, isTyping } from "@/lib/format";
import { useApp } from "./app-context";
import { Button, IconButton } from "./ui";

type Size = "s" | "m" | "l";
type Font = "sans" | "serif";
const PREFS_KEY = "tymo.reader";

function loadPrefs(): { size: Size; font: Font } {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;
    return {
      size: v.size === "s" || v.size === "l" ? v.size : "m",
      font: v.font === "serif" ? "serif" : "sans",
    };
  } catch {
    return { size: "m", font: "sans" };
  }
}

/**
 * Chrome around the (server-rendered) article: back, reading preferences, open original /
 * archived copy, and a quiet refresh while the page is still being fetched.
 */
export function ReaderShell({
  saveId,
  url,
  snapshotId,
  pending,
  empty,
  children,
}: {
  saveId: string;
  url: string | null;
  snapshotId: string | null;
  pending: boolean;
  empty: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { openSave, toast } = useApp();
  const [prefs, setPrefs] = useState<{ size: Size; font: Font }>({ size: "m", font: "sans" });
  const [busy, setBusy] = useState(false);
  const href = safeHref(url);
  const articleRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);

  // Selecting text in the article offers a "Highlight" button just above the selection.
  useEffect(() => {
    const update = () => {
      const s = window.getSelection();
      const text = s?.toString().trim() ?? "";
      if (!s || s.isCollapsed || text.length < 3 || !s.rangeCount) return setSel(null);
      const range = s.getRangeAt(0);
      const body = articleRef.current?.querySelector(".reader-body");
      if (!body?.contains(range.commonAncestorContainer)) return setSel(null);
      const r = range.getBoundingClientRect();
      setSel({ text, x: r.left + r.width / 2, y: Math.max(8, r.top - 44) });
    };
    const clear = () => setSel(null);
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", clear, { passive: true, capture: true });
    return () => {
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", clear, { capture: true });
    };
  }, []);

  const highlight = async (text: string) => {
    setSel(null);
    const res = await saveHighlightAction(saveId, text);
    if (!res.ok) return toast(res.error, { tone: "error" });
    window.getSelection()?.removeAllRanges();
    toast("Highlight saved", { tone: "success" });
    router.refresh();
  };

  useEffect(() => setPrefs(loadPrefs()), []);
  useEffect(() => {
    void markOpenedAction(saveId);
  }, [saveId]);

  // While enrichment is still running, pick up the article as soon as it lands.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => router.refresh(), 1500);
    return () => clearInterval(t);
  }, [pending, router]);

  const back = () => (history.length > 1 ? router.back() : router.push("/"));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && !document.querySelector("[role=dialog]")) back();
      if (e.key === "h" && sel) void highlight(sel.text);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const update = (next: Partial<typeof prefs>) => {
    const p = { ...prefs, ...next };
    setPrefs(p);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      /* private mode: preferences just don't persist */
    }
  };

  const refetch = async () => {
    setBusy(true);
    const res = await refreshMetadataAction(saveId);
    setBusy(false);
    if (!res.ok) toast(res.error, { tone: "error" });
    router.refresh();
  };

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 flex h-12 items-center gap-1 border-b border-border bg-panel/85 px-3 backdrop-blur md:rounded-t-xl">
        <IconButton label="Back (Esc)" onClick={back}>
          <ArrowLeft size={16} />
        </IconButton>
        <div className="flex-1" />
        <div
          role="group"
          aria-label="Text size"
          className="flex items-center rounded-md border border-border p-0.5"
        >
          {(["s", "m", "l"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={prefs.size === s}
              aria-label={{ s: "Small text", m: "Medium text", l: "Large text" }[s]}
              onClick={() => update({ size: s })}
              className={cn(
                "h-6 w-7 rounded text-fg-2 transition-colors hover:text-fg",
                prefs.size === s && "bg-surface-2 text-fg",
                s === "s" ? "text-[11px]" : s === "m" ? "text-[13px]" : "text-[15px]",
              )}
            >
              A
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => update({ font: prefs.font === "serif" ? "sans" : "serif" })}
          aria-label={prefs.font === "serif" ? "Use sans-serif font" : "Use serif font"}
          title="Toggle serif"
          className={cn(
            "h-7 rounded-md px-2 text-[13px] text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg",
            prefs.font === "serif" && "font-serif text-fg",
          )}
        >
          Aa
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <IconButton label="Details" onClick={() => openSave(saveId)}>
          <PanelRight size={15} />
        </IconButton>
        {url && (
          <IconButton label="Fetch the page again" onClick={refetch} disabled={busy}>
            <RefreshCw size={14} className={cn(busy && "animate-spin")} />
          </IconButton>
        )}
        {snapshotId && (
          <a
            href={`/files/${snapshotId}`}
            target="_blank"
            rel="noopener"
            title="Open the archived copy"
            className="inline-flex size-7 items-center justify-center rounded-md text-fg-2 hover:bg-surface-2 hover:text-fg"
          >
            <BookDown size={15} />
          </a>
        )}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-fg-2 hover:border-border-strong hover:text-fg"
          >
            <ExternalLink size={12} /> Original
          </a>
        )}
      </div>

      {sel && (
        <button
          type="button"
          // Keep the selection: don't let the mousedown collapse it before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void highlight(sel.text)}
          style={{ left: sel.x, top: sel.y }}
          className="fixed z-30 inline-flex h-8 -translate-x-1/2 animate-pop items-center gap-1.5 rounded-lg border border-border-strong bg-surface-2 px-2.5 text-xs font-medium text-fg shadow-elevated hover:bg-surface-3"
        >
          <Highlighter size={13} /> Highlight <span className="kbd touch-hidden !py-0.5">H</span>
        </button>
      )}

      <div ref={articleRef} className="reader" data-size={prefs.size} data-font={prefs.font}>
        {children}
        {pending && (
          <p className="mt-8 flex items-center gap-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" /> Fetching a readable version…
          </p>
        )}
        {empty && !pending && url && (
          <div className="card mt-8 flex flex-wrap items-center gap-3 p-4 text-sm text-fg-2">
            <span className="flex-1">
              There is no readable text for this page yet. Some sites only render in the browser.
            </span>
            <Button size="sm" onClick={refetch} disabled={busy}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Try
              again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** An article image that removes its figure when it fails to load (dead or blocked source). */
export function ReaderImage({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // An image can fail before hydration attaches onError; catch that case on mount.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) return null;
  return (
    <figure>
      {/* eslint-disable-next-line @next/next/no-img-element -- proxied, arbitrary size */}
      <img
        ref={ref}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

/** "Your highlights" at the end of an article, each removable (archived, so undoable). */
export function ReaderHighlights({ items }: { items: { id: string; text: string }[] }) {
  const router = useRouter();
  const { toast } = useApp();
  if (!items.length) return null;
  return (
    <section className="reader-highlights" aria-label="Your highlights">
      <div className="eyebrow mb-3 flex items-center gap-2">
        <Highlighter size={12} /> Your highlights · {items.length}
      </div>
      <ul className="space-y-2">
        {items.map((h) => (
          <li key={h.id} className="group flex items-start gap-2">
            <p className="flex-1">{h.text}</p>
            <button
              type="button"
              aria-label="Remove highlight"
              title="Remove highlight"
              onClick={async () => {
                const res = await bulkAction([h.id], { kind: "archive" });
                if (!res.ok) return toast(res.error, { tone: "error" });
                toast("Highlight removed (it's in the Archive)");
                router.refresh();
              }}
              className="mt-0.5 rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
