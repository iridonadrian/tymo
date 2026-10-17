"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/format";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  /** Keyboard hint shown on the right, e.g. "⌫". */
  hint?: string;
  danger?: boolean;
  /** Opens a second page of items in the same menu (e.g. a folder list). */
  items?: MenuItem[];
  onSelect?: () => void;
}
export type MenuEntry = MenuItem | "separator";

interface OpenMenu {
  x: number;
  y: number;
  entries: MenuEntry[];
}

/**
 * Right-click menus. `onContextMenu={menu.open(() => entries)}` on any element; render
 * `{menu.element}` once. Arrow keys, Enter and Escape work; it never leaves the screen.
 */
export function useContextMenu() {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const open = useCallback(
    (build: () => MenuEntry[]) => (e: React.MouseEvent | React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const pos =
        "clientX" in e && e.clientX
          ? { x: e.clientX, y: e.clientY }
          : (() => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              return { x: r.left + 24, y: r.bottom };
            })();
      setMenu({ ...pos, entries: build() });
    },
    [],
  );
  const element = menu ? <MenuPanel key={`${menu.x}:${menu.y}`} {...menu} onClose={close} /> : null;
  return { open, close, element };
}

function MenuPanel({ x, y, entries, onClose }: OpenMenu & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<{ title: string; entries: MenuEntry[] } | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const shown = page?.entries ?? entries;
  const items = shown.filter((e): e is MenuItem => e !== "separator");

  // Keep the whole menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
    el.querySelector<HTMLButtonElement>("button[role=menuitem]")?.focus();
  }, [x, y, page]);

  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const closeNow = () => onClose();
    document.addEventListener("mousedown", away, true);
    document.addEventListener("contextmenu", away, true);
    window.addEventListener("blur", closeNow);
    window.addEventListener("resize", closeNow);
    window.addEventListener("scroll", closeNow, true);
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("contextmenu", away, true);
      window.removeEventListener("blur", closeNow);
      window.removeEventListener("resize", closeNow);
      window.removeEventListener("scroll", closeNow, true);
    };
  }, [onClose]);

  const choose = (item: MenuItem) => {
    if (item.items) return setPage({ title: item.label, entries: item.items });
    onClose();
    item.onSelect?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>("button[role=menuitem]") ?? []),
    ];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") buttons[(i + 1) % buttons.length]?.focus();
    else if (e.key === "ArrowUp") buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    else if (e.key === "Escape") {
      if (page) setPage(null);
      else onClose();
    } else if (e.key === "ArrowLeft" && page) setPage(null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={ref}
      role="menu"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 max-h-[70vh] min-w-52 overflow-y-auto rounded-lg border border-border bg-panel p-1 text-sm shadow-lg"
    >
      {page && (
        <button
          type="button"
          role="menuitem"
          onClick={() => setPage(null)}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted outline-none hover:bg-surface-2 focus:bg-surface-2"
        >
          <ChevronLeft size={13} /> {page.title}
        </button>
      )}
      {shown.map((entry, i) =>
        entry === "separator" ? (
          <div key={`s${i}`} className="my-1 border-t border-border" />
        ) : (
          <button
            key={`${entry.label}${i}`}
            type="button"
            role="menuitem"
            onClick={() => choose(entry)}
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left outline-none hover:bg-surface-2 focus:bg-surface-2",
              entry.danger ? "text-danger" : "text-fg",
            )}
          >
            <span className="flex w-4 shrink-0 justify-center text-muted">{entry.icon}</span>
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.hint && <span className="font-mono text-2xs text-muted">{entry.hint}</span>}
            {entry.items && <ChevronRight size={13} className="text-muted" />}
          </button>
        ),
      )}
      {items.length === 0 && <p className="px-2 py-1.5 text-xs text-muted">Nothing here yet.</p>}
    </div>
  );
}
