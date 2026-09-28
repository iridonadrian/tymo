"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { deleteTagAction, renameTagAction } from "@/server/actions";
import { useApp } from "./app-context";
import { IconButton } from "./ui";

export function TagTable({ tags }: { tags: { id: string; name: string; count: number }[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");
  const [, start] = useTransition();
  const router = useRouter();
  const { toast } = useApp();
  const shown = filter
    ? tags.filter((t) => t.name.includes(filter.toLowerCase().replace(/^#/, "")))
    : tags;

  return (
    <div>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter tags…"
        aria-label="Filter tags"
        className="input mb-3 h-8 w-full sm:w-72"
      />
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1.5">
        {shown.map((t) => (
          <li
            key={t.id}
            className="group flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-2.5"
          >
            {editing === t.id ? (
              <form
                className="flex-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  start(async () => {
                    const res = await renameTagAction(t.id, draft);
                    if (!res.ok) toast(res.error, { tone: "error" });
                    setEditing(null);
                    router.refresh();
                  });
                }}
              >
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => setEditing(null)}
                  aria-label="New tag name"
                  className="w-full bg-transparent font-mono text-sm outline-none"
                />
              </form>
            ) : (
              <Link
                href={`/saves?q=${encodeURIComponent("tag:" + t.name)}`}
                className="min-w-0 flex-1 truncate font-mono text-sm text-fg-2 hover:text-fg"
              >
                #{t.name}
              </Link>
            )}
            <span className="font-mono text-2xs text-muted">{t.count}</span>
            <IconButton
              label={`Rename ${t.name}`}
              className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => {
                setEditing(t.id);
                setDraft(t.name);
              }}
            >
              <Pencil size={12} />
            </IconButton>
            <IconButton
              label={`Delete ${t.name}`}
              className="size-6 opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
              onClick={() => {
                if (!confirm(`Delete #${t.name}? It will be removed from ${t.count} saves.`))
                  return;
                start(async () => {
                  await deleteTagAction(t.id);
                  router.refresh();
                });
              }}
            >
              <Trash2 size={12} />
            </IconButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
