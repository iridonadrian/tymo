"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Palette, Search, X } from "lucide-react";
import { COLOR_NAMES, COLOR_SWATCHES, type ColorName } from "@tymo/core";
import { cn } from "@/lib/format";

/** Filter box bound to the ?q= search param (debounced). */
export function ListSearch({
  initial,
  placeholder = "Filter… “videos from last week”",
}: {
  initial: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(initial);
  useEffect(() => setQ(initial), [initial]);
  useEffect(() => {
    if (q === initial) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (q.trim()) params.set("q", q.trim());
      else params.delete("q");
      params.delete("sort");
      params.delete("exact");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, 220);
    return () => clearTimeout(t);
  }, [q, initial, pathname, router]);
  return (
    <div className="flex w-full items-center gap-1.5 sm:w-auto">
      <SearchBox q={q} setQ={setQ} placeholder={placeholder} />
      <ColorFilter q={q} setQ={setQ} />
    </div>
  );
}

function SearchBox({
  q,
  setQ,
  placeholder,
}: {
  q: string;
  setQ: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div role="search" className="relative w-full sm:w-80">
      <Search
        size={14}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
      />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label="Filter saves"
        className="input h-8 pr-8 pl-8 text-[13px]"
      />
      {q && (
        <button
          type="button"
          aria-label="Clear filter"
          onClick={() => setQ("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted hover:text-fg"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

const colorToken = (c: ColorName) => new RegExp(`(^|\\s)colou?r:${c}(?=\\s|$)`, "i");

/** Colour dots that toggle `color:<name>` in the filter (mymind-style colour search). */
function ColorFilter({ q, setQ }: { q: string; setQ: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const active = COLOR_NAMES.filter((c) => colorToken(c).test(q));
  const toggle = (c: ColorName) =>
    setQ(
      active.includes(c)
        ? q.replace(colorToken(c), " ").replace(/\s+/g, " ").trim()
        : `${q.trim()} color:${c}`.trim(),
    );
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Filter by colour"
        aria-expanded={open}
        title="Filter by colour"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-8 items-center gap-1 rounded-md border border-border px-2 text-fg-2 transition-colors hover:border-border-strong hover:text-fg",
          open && "border-border-strong text-fg",
        )}
      >
        {active.length ? (
          <span className="flex -space-x-1">
            {active.slice(0, 3).map((c) => (
              <span
                key={c}
                className="size-3 rounded-full ring-1 ring-surface"
                style={{ backgroundColor: COLOR_SWATCHES[c] }}
              />
            ))}
          </span>
        ) : (
          <Palette size={14} />
        )}
      </button>
      {open && (
        <div
          role="group"
          aria-label="Colours"
          className="absolute top-9 right-0 z-20 grid w-[184px] animate-pop grid-cols-6 gap-1.5 rounded-lg border border-border-strong bg-surface-2 p-2 shadow-elevated"
        >
          {COLOR_NAMES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={active.includes(c)}
              aria-label={c}
              title={c}
              onClick={() => toggle(c)}
              className={cn(
                "size-6 rounded-full ring-1 ring-border transition-transform hover:scale-110",
                active.includes(c) && "ring-2 ring-fg",
              )}
              style={{ backgroundColor: COLOR_SWATCHES[c] }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
