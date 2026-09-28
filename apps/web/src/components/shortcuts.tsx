"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isTyping } from "@/lib/format";
import { useApp } from "./app-context";
import { Dialog } from "./ui";

/** "g" then a key jumps to a page (like Gmail/GitHub). */
export const GO_TO: Record<string, [string, string]> = {
  h: ["/", "Home"],
  i: ["/inbox", "Inbox"],
  a: ["/saves", "All saves"],
  f: ["/favorites", "Favorites"],
  b: ["/bookmarks", "Bookmarks"],
  s: ["/sessions", "Sessions"],
  r: ["/serendipity", "Serendipity"],
  c: ["/collections", "Collections"],
  t: ["/tags", "Tags"],
  e: ["/archive", "Archive"],
  d: ["/duplicates", "Duplicates"],
  ",": ["/settings", "Settings"],
};

const SECTIONS: [string, [string, string][]][] = [
  [
    "Anywhere",
    [
      ["⌘K  /", "Search & commands"],
      ["N", "New save"],
      ["Paste a URL", "Save it"],
      ["?", "This help"],
    ],
  ],
  ["Go to", Object.entries(GO_TO).map(([k, [, label]]) => [`G ${k.toUpperCase()}`, label])],
  [
    "Lists",
    [
      ["J / K", "Next / previous"],
      ["Enter", "Open details"],
      ["O", "Open link"],
      ["R", "Read (clean view)"],
      ["X", "Select"],
      ["⇧A", "Select all"],
      ["F", "Favorite"],
      ["B", "Bookmark (keep on the Bookmarks page)"],
      ["E", "Done (Inbox) · Archive"],
      ["Z", "Snooze until tomorrow"],
      ["#", "Delete"],
      ["Esc", "Clear selection"],
    ],
  ],
  [
    "Quick save",
    [
      ["⌘↵", "Save"],
      ["Esc", "Close"],
    ],
  ],
];

export function Shortcuts() {
  const { detailId, paletteOpen, quickSave } = useApp();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pendingG = useRef(0);

  useEffect(() => {
    // Capture phase on document runs before the list's window listener, so "g f" never
    // also favorites the focused save.
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("dialog[open]") || paletteOpen || quickSave.open) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (detailId) return;
      if (pendingG.current && Date.now() - pendingG.current < 1200) {
        pendingG.current = 0;
        const target = GO_TO[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          e.stopPropagation();
          router.push(target[0]);
        }
        return;
      }
      if (e.key === "g" && !e.shiftKey) {
        pendingG.current = Date.now();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [detailId, paletteOpen, quickSave.open, router]);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="Keyboard shortcuts"
      className="w-[min(640px,calc(100vw-32px))]"
    >
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-2">
        {SECTIONS.map(([title, rows]) => (
          <section key={title}>
            <h3 className="eyebrow mb-2">{title}</h3>
            <dl className="space-y-1.5">
              {rows.map(([keys, label]) => (
                <div key={keys} className="flex items-baseline gap-3 text-sm">
                  <dt className="w-24 shrink-0 font-mono text-2xs text-fg">
                    <span className="kbd">{keys}</span>
                  </dt>
                  <dd className="text-fg-2">{label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
