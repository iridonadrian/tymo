"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Pin, Puzzle, Trash2 } from "lucide-react";
import { safeHref } from "@tymo/core";
import type { getSession } from "@/server/sessions";
import {
  deleteSessionAction,
  markSessionRestoredAction,
  updateSessionAction,
} from "@/server/actions";
import { fullDate } from "@/lib/format";
import { useApp } from "./app-context";
import { Favicon } from "./favicon";
import { Button } from "./ui";

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

const GROUP_COLORS: Record<string, string> = {
  grey: "#9aa0a6",
  blue: "#8ab4f8",
  red: "#f28b82",
  yellow: "#fdd663",
  green: "#81c995",
  pink: "#ff8bcb",
  purple: "#c58af9",
  cyan: "#78d9ec",
  orange: "#fcad70",
};

export function SessionView({ session }: { session: Session }) {
  const router = useRouter();
  const { toast, openSave } = useApp();
  const [name, setName] = useState(session.name);
  const [notes, setNotes] = useState(session.notes ?? "");
  const [, start] = useTransition();
  const windows = [...new Set(session.items.map((i) => i.windowIndex))];

  const save = (patch: { name?: string; notes?: string }) =>
    start(async () => {
      const res = await updateSessionAction(session.id, patch);
      if (!res.ok) toast(res.error, { tone: "error" });
      router.refresh();
    });

  const openAll = () => {
    let blocked = 0;
    for (const item of session.items) {
      const href = safeHref(item.url);
      if (href && !window.open(href, "_blank", "noopener,noreferrer")) blocked++;
    }
    void markSessionRestoredAction(session.id);
    if (blocked)
      toast(
        `Your browser blocked ${blocked} tabs. Allow pop-ups for Tymo, or restore with the extension.`,
        { tone: "error" },
      );
  };

  return (
    <div>
      <header className="mb-6">
        <div className="eyebrow mb-1.5">
          Session · {session.items.length} tabs
          {windows.length > 1 ? ` · ${windows.length} windows` : ""} · {fullDate(session.createdAt)}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== session.name && save({ name })}
          aria-label="Session name"
          className="w-full rounded-md bg-transparent text-xl font-semibold tracking-tight outline-none hover:bg-surface/60 focus:bg-surface"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (session.notes ?? "") && save({ notes })}
          placeholder="Add a note about what you were researching…"
          aria-label="Session notes"
          rows={1}
          className="field-sizing-content mt-1 w-full resize-none rounded-md bg-transparent text-sm text-fg-2 outline-none placeholder:text-muted hover:bg-surface/60 focus:bg-surface"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={openAll}>
            <ExternalLink size={14} /> Open all {session.items.length}
          </Button>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(session.items.map((i) => i.url).join("\n"));
              toast("URLs copied");
            }}
          >
            <Copy size={14} /> Copy URLs
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              toast(
                "In the extension: Sessions → Restore recreates the windows, order, pins and tab groups.",
              )
            }
          >
            <Puzzle size={14} /> Restore with extension
          </Button>
          <Button
            variant="ghost"
            className="ml-auto hover:text-danger"
            onClick={() => {
              if (!confirm("Delete this session? The saved items stay in your library.")) return;
              start(async () => {
                await deleteSessionAction(session.id);
                router.push("/sessions");
                router.refresh();
              });
            }}
          >
            <Trash2 size={14} /> Delete session
          </Button>
        </div>
      </header>

      <div className="space-y-6">
        {windows.map((w, wi) => (
          <section key={w}>
            {windows.length > 1 && <h2 className="eyebrow mb-2">Window {wi + 1}</h2>}
            <ol className="card overflow-hidden">
              {session.items
                .filter((i) => i.windowIndex === w)
                .map((item, idx, arr) => {
                  const href = safeHref(item.url);
                  const newGroup =
                    item.groupTitle !== null && item.groupTitle !== arr[idx - 1]?.groupTitle;
                  return (
                    <li key={item.id} className="border-b border-border/70 last:border-0">
                      {newGroup && (
                        <div className="flex items-center gap-2 bg-surface-2/50 px-3 pt-2 pb-1 font-mono text-2xs text-fg-2">
                          <span
                            className="size-2 rounded-full"
                            style={{
                              background: GROUP_COLORS[item.groupColor ?? "grey"] ?? "#9aa0a6",
                            }}
                          />
                          {item.groupTitle || "Tab group"}
                        </div>
                      )}
                      <div className="group flex items-center gap-3 px-3 py-2 hover:bg-surface-2/50">
                        <span className="w-6 text-right font-mono text-2xs text-muted">
                          {idx + 1}
                        </span>
                        <Favicon
                          url={item.faviconUrl}
                          domain={href ? new URL(href).hostname : null}
                          size={16}
                        />
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 flex-1 truncate text-sm hover:underline"
                        >
                          {item.title}
                        </a>
                        {item.pinned && (
                          <Pin size={12} className="text-muted" aria-label="Pinned" />
                        )}
                        <span className="hidden max-w-60 truncate font-mono text-2xs text-muted md:block">
                          {href ? new URL(href).hostname.replace(/^www\./, "") : ""}
                        </span>
                        {item.saveId && (
                          <button
                            type="button"
                            onClick={() => openSave(item.saveId!)}
                            className="font-mono text-2xs text-muted opacity-0 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
                          >
                            EDIT
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
