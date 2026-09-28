"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowRight,
  Download,
  Folder,
  FolderPlus,
  Hash,
  History,
  Inbox,
  Layers,
  Library,
  Plus,
  Puzzle,
  Search,
  Settings,
  Star,
  Upload,
  SunMoon,
  CopyCheck,
  Keyboard,
} from "lucide-react";
import type { SaveView } from "@/server/saves";
import { listSavesAction, markOpenedAction } from "@/server/actions";
import { cn } from "@/lib/format";
import { applyTheme, effectiveTheme } from "@/lib/theme";
import { useApp } from "./app-context";
import { Favicon } from "./favicon";
import { openHref } from "./save-card";
import { Tag } from "./ui";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  keywords?: string;
  run: () => void;
}

type Row = { kind: "command"; cmd: Command } | { kind: "save"; save: SaveView };

export function CommandPalette() {
  const {
    paletteOpen,
    setPaletteOpen,
    openQuickSave,
    openSave,
    collections,
    openCollectionDialog,
    toast,
  } = useApp();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SaveView[]>([]);
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      } else if (
        e.key === "/" &&
        !paletteOpen &&
        !(e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable]") &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (paletteOpen && !d.open) {
      setQ("");
      setActive(0);
      d.showModal();
    } else if (!paletteOpen && d.open) d.close();
  }, [paletteOpen]);

  useEffect(() => {
    if (!paletteOpen) return;
    let cancelled = false;
    const t = setTimeout(
      async () => {
        const res = await listSavesAction({
          q,
          limit: 8,
          sort: q.trim() ? "relevance" : "opened",
          natural: true,
        });
        if (!cancelled && res.ok) {
          setResults(res.data.items);
          setTotal(res.data.total);
        }
      },
      q ? 90 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, paletteOpen]);

  const close = () => setPaletteOpen(false);
  const go = (href: string) => () => {
    close();
    router.push(href);
  };

  const commands = useMemo<Command[]>(
    () => [
      {
        id: "new",
        label: "New save",
        hint: "N",
        icon: <Plus size={15} />,
        keywords: "add create link note url",
        run: () => (close(), openQuickSave()),
      },
      {
        id: "save-page",
        label: "Save current page",
        icon: <Puzzle size={15} />,
        keywords: "tab extension browser",
        run: () => (
          close(),
          toast("Use the browser extension: Alt+Shift+S saves the current tab.")
        ),
      },
      {
        id: "save-session",
        label: "Save session (all tabs)",
        icon: <Puzzle size={15} />,
        keywords: "tabs window extension",
        run: () => (
          close(),
          toast("Use the browser extension: open it and choose “Save session”.")
        ),
      },
      { id: "inbox", label: "Open Inbox", icon: <Inbox size={15} />, run: go("/inbox") },
      {
        id: "all",
        label: "All saves",
        icon: <Library size={15} />,
        keywords: "library",
        run: go("/saves"),
      },
      {
        id: "fav",
        label: "Favorites",
        icon: <Star size={15} />,
        keywords: "starred",
        run: go("/favorites"),
      },
      {
        id: "sessions",
        label: "Sessions",
        hint: "Restore a session",
        icon: <History size={15} />,
        keywords: "restore tabs",
        run: go("/sessions"),
      },
      {
        id: "collections",
        label: "Collections",
        icon: <Folder size={15} />,
        run: go("/collections"),
      },
      {
        id: "new-col",
        label: "Create collection",
        icon: <FolderPlus size={15} />,
        run: () => (close(), openCollectionDialog()),
      },
      {
        id: "new-smart",
        label: "Create smart collection",
        icon: <Layers size={15} />,
        keywords: "rules auto",
        run: () => (close(), openCollectionDialog(true)),
      },
      {
        id: "tags",
        label: "Tags",
        icon: <Hash size={15} />,
        keywords: "create tag",
        run: go("/tags"),
      },
      { id: "archive", label: "Archive", icon: <Archive size={15} />, run: go("/archive") },
      {
        id: "import",
        label: "Import bookmarks",
        icon: <Upload size={15} />,
        keywords: "chrome firefox safari html json",
        run: go("/settings#import"),
      },
      {
        id: "export",
        label: "Export library",
        icon: <Download size={15} />,
        keywords: "backup json csv markdown",
        run: go("/settings#export"),
      },
      {
        id: "theme",
        label: "Toggle light / dark theme",
        icon: <SunMoon size={15} />,
        keywords: "appearance dark mode light mode",
        run: () => applyTheme(effectiveTheme() === "dark" ? "light" : "dark"),
      },
      {
        id: "shortcuts",
        label: "Keyboard shortcuts",
        hint: "?",
        icon: <Keyboard size={15} />,
        keywords: "help keys hotkeys",
        run: () => {
          close();
          setTimeout(
            () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true })),
            50,
          );
        },
      },
      {
        id: "duplicates",
        label: "Find duplicates",
        icon: <CopyCheck size={15} />,
        keywords: "dedupe merge cleanup",
        run: go("/duplicates"),
      },
      {
        id: "backup",
        label: "Download full backup",
        icon: <Download size={15} />,
        keywords: "restore tar",
        run: () => {
          // A file download, not a page: let the browser handle it.
          const a = document.createElement("a");
          a.href = "/backup";
          a.download = "";
          a.click();
        },
      },
      {
        id: "settings",
        label: "Settings",
        icon: <Settings size={15} />,
        keywords: "extension token ai",
        run: go("/settings"),
      },
      ...collections.map((c) => ({
        id: `col-${c.id}`,
        label: c.name,
        hint: "Collection",
        icon: c.icon ? (
          <span className="w-[15px] text-center">{c.icon}</span>
        ) : (
          <Folder size={15} />
        ),
        keywords: "collection",
        run: go(`/collections/${c.id}`),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collections],
  );

  const needle = q.trim().toLowerCase();
  const matchedCommands = needle
    ? commands
        .filter((c) => (c.label + " " + (c.keywords ?? "")).toLowerCase().includes(needle))
        .slice(0, 6)
    : commands.slice(0, 5);

  const rows: Row[] = needle
    ? [
        ...results.map((s) => ({ kind: "save" as const, save: s })),
        ...matchedCommands.map((cmd) => ({ kind: "command" as const, cmd })),
      ]
    : [
        ...matchedCommands.map((cmd) => ({ kind: "command" as const, cmd })),
        ...results.slice(0, 5).map((s) => ({ kind: "save" as const, save: s })),
      ];
  if (needle) {
    rows.push({
      kind: "command",
      cmd: {
        id: "search-all",
        label: `Search all for “${q.trim()}”`,
        hint: `${total} ${total === 1 ? "result" : "results"}`,
        icon: <Search size={15} />,
        run: go(`/saves?q=${encodeURIComponent(q.trim())}`),
      },
    });
  }

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runRow = (row: Row, newTab = false) => {
    if (row.kind === "command") return row.cmd.run();
    const href = openHref(row.save);
    if (newTab && href) {
      window.open(href, "_blank", "noopener,noreferrer");
      void markOpenedAction(row.save.id);
      return;
    }
    close();
    openSave(row.save.id);
  };

  const firstSaveIdx = rows.findIndex((r) => r.kind === "save");
  const firstCmdIdx = rows.findIndex((r) => r.kind === "command");

  return (
    <dialog
      ref={dialogRef}
      aria-label="Command palette"
      onClose={close}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onMouseDown={(e) => e.target === dialogRef.current && close()}
      className="m-auto mt-[12vh] w-[min(640px,calc(100vw-32px))] overflow-hidden rounded-xl border border-border-strong bg-surface p-0 text-fg shadow-elevated backdrop:bg-black/60 open:animate-pop"
    >
      {paletteOpen && (
        <div
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(rows.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const row = rows[active];
              if (row) runRow(row, e.metaKey || e.ctrlKey);
            }
          }}
        >
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search size={16} className="shrink-0 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search saves or type a command…  (try tag:osint, domain:github.com, is:fav)"
              aria-label="Search"
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={rows[active] ? `palette-${active}` : undefined}
              className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-muted"
            />
            <kbd className="kbd">esc</kbd>
          </div>
          <div
            ref={listRef}
            id="palette-list"
            role="listbox"
            className="max-h-[min(60vh,440px)] overflow-y-auto p-1.5"
          >
            {rows.map((row, idx) => (
              <div key={row.kind === "save" ? row.save.id : row.cmd.id}>
                {idx === firstSaveIdx && (
                  <div className="eyebrow px-2.5 pt-2 pb-1">
                    {needle ? "Saves" : "Recently opened"}
                  </div>
                )}
                {idx === firstCmdIdx && <div className="eyebrow px-2.5 pt-2 pb-1">Commands</div>}
                <div
                  id={`palette-${idx}`}
                  data-idx={idx}
                  role="option"
                  aria-selected={idx === active}
                  onMouseMove={() => setActive(idx)}
                  onClick={(e) => runRow(row, e.metaKey || e.ctrlKey)}
                  className={cn(
                    "flex h-10 cursor-default items-center gap-3 rounded-lg px-2.5 text-sm",
                    idx === active ? "bg-surface-2" : "",
                  )}
                >
                  {row.kind === "command" ? (
                    <>
                      <span className="text-fg-2">{row.cmd.icon}</span>
                      <span className="flex-1 truncate">{row.cmd.label}</span>
                      {row.cmd.hint && (
                        <span className="font-mono text-2xs text-muted">{row.cmd.hint}</span>
                      )}
                      {idx === active && <ArrowRight size={13} className="text-muted" />}
                    </>
                  ) : (
                    <>
                      <Favicon
                        url={row.save.faviconUrl}
                        domain={row.save.domain}
                        type={row.save.type}
                        size={16}
                      />
                      <span className="min-w-0 flex-1 truncate">{row.save.title}</span>
                      <span className="hidden gap-1 sm:flex">
                        {row.save.tags.slice(0, 2).map((t) => (
                          <Tag key={t} name={t} />
                        ))}
                      </span>
                      <span className="max-w-32 truncate font-mono text-2xs text-muted">
                        {row.save.domain}
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
            {needle && results.length === 0 && (
              <p className="px-3 py-3 text-sm text-muted">
                No saves match. Try fewer words, or a filter like tag: or domain:.
              </p>
            )}
          </div>
          <div className="flex gap-4 border-t border-border px-4 py-2 font-mono text-2xs text-muted">
            <span>
              <kbd className="kbd">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="kbd">↵</kbd> open
            </span>
            <span>
              <kbd className="kbd">⌘↵</kbd> open link
            </span>
          </div>
        </div>
      )}
    </dialog>
  );
}
