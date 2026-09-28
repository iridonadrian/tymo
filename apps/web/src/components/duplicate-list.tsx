"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { safeHref } from "@tymo/core";
import type { DuplicatePair } from "@/server/duplicates";
import type { SaveView } from "@/server/saves";
import { dismissDuplicateAction, mergeSavesAction } from "@/server/actions";
import { useApp } from "./app-context";
import { Favicon } from "./favicon";
import { Button, Tag, Time } from "./ui";

const REASONS: Record<DuplicatePair["reason"], string> = {
  "same-page": "SAME PAGE",
  "same-title": "SAME TITLE",
  similar: "SIMILAR CONTENT",
};

export function DuplicateList({ pairs }: { pairs: DuplicatePair[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast, openSave } = useApp();

  const act = (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return toast(res.error ?? "Something went wrong", { tone: "error" });
      setHidden((h) => new Set(h).add(key));
      toast(msg, { tone: "success" });
      router.refresh();
    });

  const shown = pairs.filter((p) => !hidden.has(p.key));
  return (
    <ul className="space-y-3">
      {shown.map((p) => (
        <li key={p.key} className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="rounded-sm border border-border px-1 font-mono text-[10px] text-fg-2">
              {REASONS[p.reason]}
              {p.reason === "similar" && ` · ${Math.round(p.score * 100)}%`}
            </span>
            <span className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                act(p.key, () => dismissDuplicateAction(p.a.id, p.b.id), "Marked as different")
              }
            >
              <X size={12} /> Not duplicates
            </Button>
          </div>
          <div className="grid divide-border sm:grid-cols-2 sm:divide-x">
            {[
              [p.a, p.b],
              [p.b, p.a],
            ].map(([keep, drop]) => (
              <Side
                key={keep!.id}
                save={keep!}
                onOpen={() => openSave(keep!.id)}
                onKeep={() =>
                  act(p.key, () => mergeSavesAction(keep!.id, drop!.id), "Merged into one save")
                }
                disabled={pending}
              />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Side({
  save,
  onOpen,
  onKeep,
  disabled,
}: {
  save: SaveView;
  onOpen: () => void;
  onKeep: () => void;
  disabled: boolean;
}) {
  const href = safeHref(save.url);
  return (
    <div className="flex min-w-0 flex-col gap-1.5 p-3">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 items-center gap-2 text-left text-sm font-medium hover:underline"
      >
        <Favicon url={save.faviconUrl} domain={save.domain} type={save.type} size={16} />
        <span className="truncate">{save.title}</span>
      </button>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate font-mono text-2xs text-muted hover:text-fg-2"
        >
          {save.url}
        </a>
      )}
      {save.description && <p className="line-clamp-2 text-xs text-fg-2">{save.description}</p>}
      <div className="flex flex-wrap items-center gap-1 pt-1">
        {save.tags.slice(0, 4).map((t) => (
          <Tag key={t} name={t} />
        ))}
        {save.collections.slice(0, 2).map((c) => (
          <span key={c.id} className="font-mono text-2xs text-fg-2">
            {c.icon ? `${c.icon} ` : ""}
            {c.name}
          </span>
        ))}
      </div>
      <div className="mt-auto flex items-center gap-2 pt-2">
        <Time ts={save.createdAt} />
        <span className="flex-1" />
        <Button size="sm" disabled={disabled} onClick={onKeep}>
          <Check size={12} /> Keep this one
        </Button>
      </div>
    </div>
  );
}
