"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  Archive,
  BookOpen,
  Check,
  ExternalLink,
  Loader2,
  PanelRight,
  RotateCcw,
  Shuffle,
  Star,
  Undo2,
} from "lucide-react";
import { SAVE_TYPE_LABELS } from "@tymo/core";
import type { SaveView } from "@/server/saves";
import { bulkAction, markOpenedAction, reviewAction, serendipityAction } from "@/server/actions";
import { cn, imageSrc, isTyping } from "@/lib/format";
import { reportColors } from "@/lib/colors-client";
import { useApp } from "./app-context";
import { Favicon } from "./favicon";
import { FactsLine, openHref } from "./save-card";
import { Button, Tag } from "./ui";

type Decision = "keep" | "archive" | "favorite" | "snooze";
const SWIPE = 110;

const UNDO: Record<Decision, Parameters<typeof bulkAction>[1] | null> = {
  keep: null,
  archive: { kind: "unarchive" },
  favorite: { kind: "unfavorite" },
  snooze: { kind: "snooze", until: null },
};

/**
 * Serendipity: resurface older saves one at a time and decide quickly — keep, archive,
 * favorite or snooze. Keyboard (K / A / F / S, arrows) or swipe on touch screens.
 */
export function Serendipity() {
  const router = useRouter();
  const { openSave, toast, detailId, paletteOpen } = useApp();
  const [queue, setQueue] = useState<SaveView[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [history, setHistory] = useState<{ idx: number; decision: Decision }[]>([]);
  const [leaving, setLeaving] = useState<null | "left" | "right" | "up">(null);
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; id: number } | null>(null);

  const load = useCallback(async () => {
    setQueue(null);
    const res = await serendipityAction();
    setQueue(res.ok ? res.data : []);
    setIdx(0);
    setHistory([]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const current = queue?.[idx];

  const decide = useCallback(
    (decision: Decision) => {
      if (!current || leaving) return;
      setLeaving(decision === "archive" ? "left" : decision === "keep" ? "right" : "up");
      void reviewAction(current.id, decision).then((res) => {
        if (!res.ok) toast(res.error, { tone: "error" });
      });
      setHistory((h) => [...h, { idx, decision }]);
      setTimeout(() => {
        setLeaving(null);
        setDx(0);
        setIdx((i) => i + 1);
      }, 180);
    },
    [current, leaving, idx, toast],
  );

  const undo = useCallback(async () => {
    const last = history[history.length - 1];
    if (!last || !queue) return;
    setHistory((h) => h.slice(0, -1));
    setIdx(last.idx);
    const op = UNDO[last.decision];
    if (op) {
      const res = await bulkAction([queue[last.idx]!.id], op);
      if (!res.ok) toast(res.error, { tone: "error" });
    }
  }, [history, queue, toast]);

  const open = useCallback((s: SaveView) => {
    const href = openHref(s);
    if (!href) return;
    window.open(href, "_blank", "noopener,noreferrer");
    void markOpenedAction(s.id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || detailId || paletteOpen) return;
      if (document.querySelector("dialog[open]")) return;
      if (!current) return;
      const k = e.key.toLowerCase();
      const map: Record<string, () => void> = {
        k: () => decide("keep"),
        arrowright: () => decide("keep"),
        a: () => decide("archive"),
        arrowleft: () => decide("archive"),
        f: () => decide("favorite"),
        s: () => decide("snooze"),
        u: () => void undo(),
        o: () => open(current),
        r: () => router.push(`/read/${current.id}`),
        enter: () => openSave(current.id),
      };
      const fn = map[k];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, decide, undo, open, router, openSave, detailId, paletteOpen]);

  if (!queue) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  if (!current) {
    const reviewed = history.length;
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface">
          <Shuffle size={18} className="text-fg-2" />
        </div>
        <h2 className="mt-5 text-lg font-semibold">
          {reviewed ? "All caught up" : "Nothing to rediscover yet"}
        </h2>
        <p className="mt-2 text-sm text-fg-2">
          {reviewed
            ? `You went through ${reviewed} ${reviewed === 1 ? "save" : "saves"}. Reviewed saves rest for a month before they come back.`
            : "Serendipity brings back saves older than a few days that you haven't reviewed in the last month."}
        </p>
        <div className="mt-6 flex gap-2">
          {history.length > 0 && (
            <Button onClick={() => void undo()}>
              <Undo2 size={13} /> Undo last
            </Button>
          )}
          <Button variant="primary" onClick={() => void load()}>
            <RotateCcw size={13} /> Another round
          </Button>
        </div>
      </div>
    );
  }

  const thumb =
    current.fileId && current.fileMime?.startsWith("image/")
      ? `/files/${current.fileId}`
      : imageSrc(current.imageUrl);
  const text = current.description ?? current.excerpt;
  const isQuote = ["quote", "snippet", "note"].includes(current.type) && !thumb;
  const transform = leaving
    ? leaving === "left"
      ? "translateX(-120%) rotate(-8deg)"
      : leaving === "right"
        ? "translateX(120%) rotate(8deg)"
        : "translateY(-40px) scale(0.96)"
    : dx
      ? `translateX(${dx}px) rotate(${dx / 30}deg)`
      : undefined;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-xl flex-col px-4 py-6 md:py-10">
      <div className="mb-4 flex items-center gap-3">
        <span className="eyebrow">Serendipity</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${(idx / queue.length) * 100}%` }}
          />
        </div>
        <span className="font-mono text-2xs text-muted">
          {idx + 1} / {queue.length}
        </span>
      </div>

      <div className="relative flex-1 md:flex-none">
        <article
          key={current.id}
          aria-label={current.title}
          onPointerDown={(e) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            if ((e.target as HTMLElement).closest("a,button")) return;
            drag.current = { x: e.clientX, id: e.pointerId };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag.current?.id === e.pointerId) setDx(e.clientX - drag.current.x);
          }}
          onPointerUp={() => {
            if (!drag.current) return;
            drag.current = null;
            if (dx > SWIPE) decide("keep");
            else if (dx < -SWIPE) decide("archive");
            else setDx(0);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDx(0);
          }}
          style={{ transform, opacity: leaving ? 0 : 1 }}
          className={cn(
            "card relative touch-pan-y overflow-hidden select-none",
            !drag.current && "transition-[transform,opacity] duration-200 ease-out",
          )}
        >
          <SwipeHint dx={dx} />
          {thumb ? (
            <div className="border-b border-border bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumb}
                alt=""
                draggable={false}
                decoding="async"
                referrerPolicy="no-referrer"
                onLoad={(e) => current.colors === null && reportColors(current.id, e.currentTarget)}
                className="mx-auto max-h-[46vh] w-full object-contain"
              />
            </div>
          ) : null}
          <div className="space-y-3 p-5">
            <div className="flex items-center gap-2 font-mono text-2xs text-muted">
              <Favicon
                url={current.faviconUrl}
                domain={current.domain}
                type={current.type}
                size={14}
              />
              <span className="truncate">{current.domain ?? SAVE_TYPE_LABELS[current.type]}</span>
              <span>·</span>
              <span className="shrink-0">saved {ago(current.createdAt)}</span>
              <span className="ml-auto shrink-0">
                {current.lastOpenedAt ? `opened ${ago(current.lastOpenedAt)}` : "never opened"}
              </span>
            </div>
            {isQuote && text ? (
              <blockquote className="font-serif text-lg leading-relaxed text-fg">
                {current.type === "quote" ? `“${text}”` : text}
              </blockquote>
            ) : (
              <>
                <h2 className="text-xl leading-snug font-semibold text-balance">{current.title}</h2>
                <FactsLine save={current} />
                {text && <p className="line-clamp-5 text-sm leading-relaxed text-fg-2">{text}</p>}
              </>
            )}
            {current.notes && (
              <p className="rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-sm text-fg-2">
                {current.notes}
              </p>
            )}
            {(current.tags.length > 0 || current.collections.length > 0) && (
              <div className="flex flex-wrap gap-1">
                {current.collections.map((c) => (
                  <span
                    key={c.id}
                    className="rounded-md border border-border px-1.5 text-2xs leading-5 text-fg-2"
                  >
                    {c.icon ? `${c.icon} ` : ""}
                    {c.name}
                  </span>
                ))}
                {current.tags.map((t) => (
                  <Tag key={t} name={t} />
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {openHref(current) && (
                <Button size="sm" onClick={() => open(current)}>
                  <ExternalLink size={12} /> Open <Kbd>O</Kbd>
                </Button>
              )}
              {(current.url || current.type === "note") && (
                <Link
                  href={`/read/${current.id}`}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-fg-2 hover:border-border-strong hover:text-fg"
                >
                  <BookOpen size={12} /> Read <Kbd>R</Kbd>
                </Link>
              )}
              <Button size="sm" variant="ghost" onClick={() => openSave(current.id)}>
                <PanelRight size={12} /> Details <Kbd>↵</Kbd>
              </Button>
            </div>
          </div>
        </article>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-2">
        <Choice label="Archive" hint="A" onClick={() => decide("archive")}>
          <Archive size={16} />
        </Choice>
        <Choice label="Snooze a week" hint="S" onClick={() => decide("snooze")}>
          <AlarmClock size={16} />
        </Choice>
        <Choice label="Favorite" hint="F" onClick={() => decide("favorite")}>
          <Star size={16} />
        </Choice>
        <Choice label="Keep" hint="K" primary onClick={() => decide("keep")}>
          <Check size={16} />
        </Choice>
      </div>
      <div className="mt-3 flex items-center justify-between text-2xs text-muted">
        <span className="touch-hidden">← archive · → keep · U undo</span>
        <span className="hidden [@media(pointer:coarse)]:inline">
          Swipe left to archive, right to keep
        </span>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => void undo()}
            className="flex items-center gap-1 hover:text-fg"
          >
            <Undo2 size={12} /> Undo
          </button>
        )}
      </div>
    </div>
  );
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 months ago", "last week", "yesterday". */
function ago(ts: number, now = Date.now()) {
  const days = (now - ts) / 86_400_000;
  if (days < 1) return "today";
  if (days < 7) return rtf.format(-Math.round(days), "day");
  if (days < 30) return rtf.format(-Math.round(days / 7), "week");
  if (days < 365) return rtf.format(-Math.round(days / 30), "month");
  return rtf.format(-Math.round(days / 365), "year");
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <span className="kbd touch-hidden ml-0.5 !px-1 !py-0.5 text-[10px]">{children}</span>;
}

function Choice({
  label,
  hint,
  primary,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  primary?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} (${hint})`}
      className={cn(
        "flex h-14 flex-col items-center justify-center gap-1 rounded-xl border text-xs font-medium transition-colors",
        primary
          ? "border-transparent bg-accent text-on-accent hover:bg-accent-hover"
          : "border-border bg-surface text-fg-2 hover:border-border-strong hover:text-fg",
      )}
    >
      {children}
      <span className="flex items-center gap-1">
        {label} <span className="touch-hidden font-mono opacity-60">{hint}</span>
      </span>
    </button>
  );
}

function SwipeHint({ dx }: { dx: number }) {
  if (Math.abs(dx) < 24) return null;
  const keep = dx > 0;
  return (
    <span
      className={cn(
        "absolute top-4 z-10 rounded-md border px-2 py-1 font-mono text-xs tracking-wider",
        keep ? "left-4 border-accent text-accent-ink" : "right-4 border-border-strong text-fg-2",
      )}
      style={{ opacity: Math.min(1, Math.abs(dx) / SWIPE) }}
    >
      {keep ? "KEEP" : "ARCHIVE"}
    </span>
  );
}
