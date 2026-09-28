"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BookmarkMinus,
  ClipboardPaste,
  Columns2,
  Folder,
  Globe,
  List,
  Loader2,
  PanelRight,
  Search,
  X,
} from "lucide-react";
import { parsePastedLinks, safeHref } from "@tymo/core";
import type { BookmarkItem } from "@/server/saves";
import { addBookmarksAction, bulkAction, markOpenedAction } from "@/server/actions";
import { cn } from "@/lib/format";
import { useApp } from "./app-context";
import { Favicon } from "./favicon";
import { Button, Dialog, EmptyState } from "./ui";

type View = "list" | "columns";
type Group = "folder" | "site" | "none";
type Sort = "az" | "used" | "recent";
interface Prefs {
  view: View;
  group: Group;
  sort: Sort;
}
const PREFS_KEY = "tymo:bookmarks";
const DEFAULT_PREFS: Prefs = { view: "columns", group: "folder", sort: "az" };

function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return {
      view: v.view === "list" ? "list" : "columns",
      group: v.group === "site" || v.group === "none" ? v.group : "folder",
      sort: v.sort === "used" || v.sort === "recent" ? v.sort : "az",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

const matches = (b: BookmarkItem, q: string) =>
  !q ||
  q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => `${b.title} ${b.domain ?? ""} ${b.folder?.name ?? ""}`.toLowerCase().includes(w));

/**
 * Bookmarks: the sites you come back to, on one calm page instead of a row of open tabs.
 * A launcher: type to filter, Enter opens the first match, every link opens in a new tab.
 */
export function BookmarksView({ items }: { items: BookmarkItem[] }) {
  const router = useRouter();
  const { openSave, toast } = useApp();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [q, setQ] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPrefs(loadPrefs());
    // A launcher starts typing-ready (not on touch screens: no keyboard popping up).
    if (!window.matchMedia("(pointer: coarse)").matches) input.current?.focus();
  }, []);
  const update = (p: Partial<Prefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };

  const groups = useMemo(() => {
    const list = items.filter((b) => matches(b, q.trim()));
    list.sort((a, b) =>
      prefs.sort === "used"
        ? b.openCount - a.openCount || (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)
        : prefs.sort === "recent"
          ? b.createdAt - a.createdAt
          : a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
    const map = new Map<
      string,
      { key: string; name: string; icon: React.ReactNode; items: BookmarkItem[] }
    >();
    for (const b of list) {
      const key =
        prefs.group === "folder"
          ? (b.folder?.id ?? "")
          : prefs.group === "site"
            ? (b.domain ?? "")
            : "all";
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          name:
            prefs.group === "folder"
              ? (b.folder?.name ?? "Unsorted")
              : prefs.group === "site"
                ? (b.domain ?? "Other")
                : "All bookmarks",
          icon:
            prefs.group === "folder" ? (
              b.folder?.icon ? (
                <span className="text-xs">{b.folder.icon}</span>
              ) : (
                <Folder size={12} />
              )
            ) : prefs.group === "site" ? (
              <Globe size={12} />
            ) : null,
          items: [],
        };
        map.set(key, g);
      }
      g.items.push(b);
    }
    // Named groups A–Z, the catch-all last.
    return [...map.values()].sort((a, b) =>
      a.key === "" ? 1 : b.key === "" ? -1 : a.name.localeCompare(b.name),
    );
  }, [items, q, prefs.group, prefs.sort]);

  const first = groups[0]?.items[0];
  const open = (b: BookmarkItem) => void markOpenedAction(b.id);
  const remove = (b: BookmarkItem) =>
    start(async () => {
      const res = await bulkAction([b.id], { kind: "unbookmark" });
      if (!res.ok) return toast(res.error, { tone: "error" });
      toast(`Removed “${b.title}” from Bookmarks (still in your library)`);
      router.refresh();
    });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div role="search" className="relative w-full sm:w-80">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
          />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && first) {
                const href = safeHref(first.url);
                if (href) {
                  window.open(href, "_blank", "noopener,noreferrer");
                  open(first);
                }
              }
              if (e.key === "Escape") {
                setQ("");
                e.currentTarget.blur();
              }
            }}
            placeholder="Filter bookmarks… Enter opens the first"
            aria-label="Filter bookmarks"
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
        <div className="flex-1" />
        <select
          value={prefs.group}
          onChange={(e) => update({ group: e.target.value as Group })}
          aria-label="Group by"
          className="h-8 rounded-md border border-border bg-surface-2 px-2 font-mono text-2xs text-fg-2"
        >
          <option value="folder">By folder</option>
          <option value="site">By site</option>
          <option value="none">No groups</option>
        </select>
        <select
          value={prefs.sort}
          onChange={(e) => update({ sort: e.target.value as Sort })}
          aria-label="Sort"
          className="h-8 rounded-md border border-border bg-surface-2 px-2 font-mono text-2xs text-fg-2"
        >
          <option value="az">A–Z</option>
          <option value="used">Most used</option>
          <option value="recent">Recently added</option>
        </select>
        <div
          role="radiogroup"
          aria-label="Layout"
          className="flex rounded-md border border-border bg-surface-2 p-0.5"
        >
          {(
            [
              ["list", List, "List"],
              ["columns", Columns2, "Two columns"],
            ] as const
          ).map(([v, Icon, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={prefs.view === v}
              aria-label={label}
              title={label}
              onClick={() => update({ view: v })}
              className={cn(
                "flex size-6 items-center justify-center rounded",
                prefs.view === v ? "bg-surface-3 text-fg" : "text-muted hover:text-fg-2",
              )}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
        <Button onClick={() => setPasteOpen(true)}>
          <ClipboardPaste size={13} /> Paste links
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<Globe size={18} />} title="Keep your sites here, not in open tabs">
          <p>
            Click <strong className="font-medium text-fg">Paste links</strong> to add many at once.
            In Safari, select your tabs, right-click and choose <em>Copy Links</em>. In Dia or
            Chrome, use the Tymo extension. You can also press <kbd className="kbd">B</kbd> on any
            save, or import your browser’s bookmarks file in Settings.
          </p>
        </EmptyState>
      ) : groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No bookmarks match “{q}”.</p>
      ) : (
        <div className={cn(prefs.view === "columns" && "gap-6 md:columns-2")}>
          {groups.map((g) => (
            <section key={g.key || "_"} className="mb-6 break-inside-avoid">
              {prefs.group !== "none" && (
                <h2 className="mb-1.5 flex items-center gap-1.5 px-2 text-muted">
                  {g.icon}
                  <span className="eyebrow">{g.name}</span>
                  <span className="font-mono text-2xs">{g.items.length}</span>
                </h2>
              )}
              <ul className="overflow-hidden rounded-lg border border-border bg-surface">
                {g.items.map((b) => {
                  const href = safeHref(b.url);
                  return (
                    <li
                      key={b.id}
                      className={cn(
                        "group flex items-center border-b border-border/60 last:border-b-0 hover:bg-surface-2",
                        first?.id === b.id && q && "bg-accent-soft",
                      )}
                    >
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => open(b)}
                        className="flex h-9 min-w-0 flex-1 items-center gap-2.5 px-3 text-sm outline-none focus-visible:bg-surface-2"
                      >
                        <Favicon url={b.faviconUrl} domain={b.domain} size={16} />
                        <span className="min-w-0 flex-1 truncate text-fg">{b.title}</span>
                        {prefs.group !== "site" && (
                          <span className="hidden shrink-0 truncate font-mono text-2xs text-muted sm:block sm:max-w-[40%]">
                            {b.domain}
                          </span>
                        )}
                      </a>
                      <div className="flex shrink-0 items-center gap-0.5 pr-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                        <button
                          type="button"
                          aria-label={`Details for ${b.title}`}
                          title="Details"
                          onClick={() => openSave(b.id)}
                          className="rounded p-1 text-muted hover:bg-surface-3 hover:text-fg"
                        >
                          <PanelRight size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${b.title} from Bookmarks`}
                          title="Remove from Bookmarks"
                          onClick={() => remove(b)}
                          className="rounded p-1 text-muted hover:bg-surface-3 hover:text-fg"
                        >
                          <BookmarkMinus size={13} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <PasteLinksDialog open={pasteOpen} onClose={() => setPasteOpen(false)} />
    </div>
  );
}

/** Paste a list of links (Safari "Copy Links", a tab list, Markdown…) to bookmark them all. */
function PasteLinksDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast, collections } = useApp();
  const [text, setText] = useState("");
  const [folder, setFolder] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const found = useMemo(() => parsePastedLinks(text), [text]);
  const folders = collections.filter((c) => !c.smart);

  const submit = async () => {
    setBusy(true);
    const res = await addBookmarksAction({
      text,
      collectionId: folder && folder !== "__new" ? folder : undefined,
      newFolder: folder === "__new" ? newFolder : undefined,
    });
    setBusy(false);
    if (!res.ok) return toast(res.error, { tone: "error" });
    const { added, existing } = res.data;
    toast(
      `${added} bookmark${added === 1 ? "" : "s"} added` +
        (existing ? ` · ${existing} already saved, now bookmarked` : ""),
      { tone: "success" },
    );
    setText("");
    setNewFolder("");
    onClose();
    router.refresh();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Paste links">
      <div className="space-y-3 p-5">
        <div>
          <h2 className="text-sm font-semibold">Paste links</h2>
          <p className="mt-1 text-xs text-fg-2">
            Safari: select tabs (⌘-click or Shift-click), right-click, <em>Copy Links</em>. Any list
            works: one link per line, “Title – link”, or Markdown. Titles and icons are fetched for
            you.
          </p>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          autoFocus
          aria-label="Links"
          placeholder={
            "https://linear.app/\nhttps://figma.com/\nHacker News – https://news.ycombinator.com/"
          }
          className="input resize-y font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            aria-label="Folder"
            className="input h-8 w-auto py-0 text-xs"
          >
            <option value="">No folder</option>
            {folders.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon ? `${c.icon} ` : ""}
                {c.name}
              </option>
            ))}
            <option value="__new">New folder…</option>
          </select>
          {folder === "__new" && (
            <input
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              placeholder="Folder name"
              aria-label="New folder name"
              className="input h-8 w-44 py-0 text-xs"
            />
          )}
          <span className="flex-1 text-right font-mono text-2xs text-muted">
            {found.length} link{found.length === 1 ? "" : "s"} found
          </span>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !found.length || (folder === "__new" && !newFolder.trim())}
            onClick={submit}
          >
            {busy && <Loader2 size={13} className="animate-spin" />} Add {found.length || ""}{" "}
            bookmark{found.length === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
