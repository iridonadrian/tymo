"use client";

import { useId, useState } from "react";
import { normalizeTag } from "@tymo/core";
import { useApp } from "./app-context";
import { Tag } from "./ui";

/** Lightweight tag entry: type, press Enter/comma/space to add, Backspace to remove. */
export function TagInput({
  value,
  onChange,
  placeholder = "Add tags…",
  autoFocus,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { tags: known } = useApp();
  const [draft, setDraft] = useState("");
  const listId = useId();

  const add = (raw: string) => {
    const t = normalizeTag(raw);
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  const suggestions = draft
    ? known.filter((k) => k.startsWith(normalizeTag(draft)) && !value.includes(k)).slice(0, 6)
    : [];

  return (
    <div className="input flex min-h-8 flex-wrap items-center gap-1 px-1.5 py-1 focus-within:border-accent">
      {value.map((t) => (
        <Tag key={t} name={t} onRemove={() => onChange(value.filter((x) => x !== t))} />
      ))}
      <input
        value={draft}
        autoFocus={autoFocus}
        list={listId}
        aria-label="Tags"
        onChange={(e) => {
          const v = e.target.value;
          if (/[,\s]$/.test(v) && v.trim()) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={value.length ? "" : placeholder}
        className="min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted"
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

export function CollectionSelect({
  value,
  onChange,
  label = "Collection",
  includeSmart = false,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  includeSmart?: boolean;
}) {
  const { collections } = useApp();
  const byParent = (pid: string | null) =>
    collections.filter((c) => (c.parentId ?? null) === pid && (includeSmart || !c.smart));
  const opts: { id: string; label: string }[] = [];
  const walk = (pid: string | null, depth: number) => {
    for (const c of byParent(pid)) {
      opts.push({ id: c.id, label: `${"  ".repeat(depth)}${c.icon ? c.icon + " " : ""}${c.name}` });
      if (depth < 4) walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="input h-8 py-0"
    >
      <option value="">Inbox (no collection)</option>
      {opts.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
