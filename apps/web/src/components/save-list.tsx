"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  Archive,
  ArchiveRestore,
  Bookmark,
  BookmarkMinus,
  Check,
  Copy,
  ExternalLink,
  PanelRight,
  FolderPlus,
  Hash,
  Inbox,
  LayoutGrid,
  List,
  Rows3,
  Sparkles,
  Star,
  Trash2,
  X,
  Loader2,
} from "lucide-react";
import type { ListParams, SaveView, SortKey } from "@/server/saves";
import {
  bulkAction,
  interpretQueryAction,
  listSavesAction,
  markOpenedAction,
} from "@/server/actions";
import { cn, formatCount, isTyping } from "@/lib/format";
import { useApp } from "./app-context";
import { SaveCard, openHref, type ViewMode } from "./save-card";
import { Button } from "./ui";
import { SnoozeMenu } from "./snooze-menu";
import { useContextMenu, type MenuEntry } from "./context-menu";
import { isPendingDelete, useUndoableDelete } from "./undo-delete";
import { snoozePresets } from "@/lib/snooze";

type BulkKind = Parameters<typeof bulkAction>[1];

const VIEW_KEY = "tymo:view";

function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>("list");
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "grid" || v === "list" || v === "dense") setMode(v);
    } catch {
      /* storage unavailable */
    }
  }, []);
  return [
    mode,
    (m) => {
      setMode(m);
      try {
        localStorage.setItem(VIEW_KEY, m);
      } catch {
        /* ignore */
      }
    },
  ];
}

/** Shows how a natural-language search was read, with an optional AI re-interpretation. */
function Interpreted({ original, query }: { original: string; query: string }) {
  const router = useRouter();
  const { aiEnabled, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const go = (q: string, exact = false) => {
    const p = new URLSearchParams(window.location.search);
    p.set("q", q);
    p.delete("sort");
    if (exact) p.set("exact", "1");
    else p.delete("exact");
    router.replace(`${window.location.pathname}?${p}`);
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <span>Searching for</span>
      <code className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-fg-2">
        {query}
      </code>
      <button
        type="button"
        onClick={() => go(original, true)}
        className="hover:text-fg-2 hover:underline"
      >
        Search the exact words instead
      </button>
      {aiEnabled && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await interpretQueryAction(original);
            setBusy(false);
            if (!res.ok) return toast(res.error, { tone: "error" });
            go(res.data);
          }}
          className="inline-flex items-center gap-1 text-accent-ink hover:underline disabled:opacity-60"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Ask AI to
          interpret
        </button>
      )}
    </div>
  );
}

const COLUMN_MIN = 240;
const GAP = 12;

/** Number of masonry columns that fit the list's width (≥ 240px each). */
function useColumns(ref: React.RefObject<HTMLDivElement | null>, active: boolean) {
  const [n, setN] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const measure = () =>
      setN(Math.max(1, Math.floor((el.clientWidth + GAP) / (COLUMN_MIN + GAP))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active]);
  return n;
}

export function SaveList({
  initial,
  params,
  empty,
  toolbarExtra,
  showSort = true,
  interpreted,
}: {
  initial: { items: SaveView[]; total: number; hasMore: boolean };
  interpreted?: string;
  params: ListParams;
  empty: React.ReactNode;
  toolbarExtra?: React.ReactNode;
  showSort?: boolean;
}) {
  const router = useRouter();
  const { openSave, toast, collections, detailId, paletteOpen, quickSave } = useApp();
  const undoableDelete = useUndoableDelete();
  const [mode, setMode] = useViewMode();
  const [items, setItems] = useState(initial.items);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(-1);
  const anchor = useRef<number | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const [bulkMenu, setBulkMenu] = useState<null | "collection" | "tag">(null);
  const [tagDraft, setTagDraft] = useState("");
  const sort = params.sort;

  // Server data changed (after a mutation + router.refresh): reset the list.
  useEffect(() => {
    setItems(initial.items.filter((i) => !isPendingDelete(i.id)));
    setHasMore(initial.hasMore);
    setSelected((s) => new Set([...s].filter((id) => initial.items.some((i) => i.id === id))));
  }, [initial]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const res = await listSavesAction({ ...params, offset: items.length, limit: 60 });
    setLoadingMore(false);
    if (res.ok) {
      setItems((cur) => {
        const seen = new Set(cur.map((i) => i.id));
        return [...cur, ...res.data.items.filter((i) => !seen.has(i.id))];
      });
      setHasMore(res.data.hasMore);
    }
  }, [loadingMore, hasMore, params, items.length]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && loadMore(), {
      rootMargin: "600px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const selectionActive = selected.size > 0;
  const menu = useContextMenu();

  /** Right-click menu: for the selection when the item is part of it, else for that item. */
  const entriesFor = (s: SaveView): MenuEntry[] => {
    const ids = selected.has(s.id) && selected.size > 1 ? [...selected] : [s.id];
    const many = ids.length > 1;
    const href = openHref(s);
    const n = many ? ` (${ids.length})` : "";
    const single: MenuEntry[] = many
      ? []
      : [
          ...(href
            ? [
                {
                  label: "Open link",
                  icon: <ExternalLink size={13} />,
                  onSelect: () => {
                    window.open(href, "_blank", "noopener,noreferrer");
                    openLink(s);
                  },
                },
              ]
            : []),
          ...(s.url
            ? [
                {
                  label: "Copy link",
                  icon: <Copy size={13} />,
                  onSelect: () =>
                    navigator.clipboard.writeText(s.url!).then(
                      () => toast("Link copied", { tone: "success" }),
                      () => toast("Couldn't copy the link", { tone: "error" }),
                    ),
                },
              ]
            : []),
          {
            label: "Details and edit",
            icon: <PanelRight size={13} />,
            onSelect: () => openSave(s.id),
          },
          "separator" as const,
        ];
    const folders = collections.filter((c) => !c.smart);
    return [
      ...single,
      {
        label: (s.isFavorite ? "Remove from favorites" : "Add to favorites") + n,
        icon: <Star size={13} />,
        onSelect: () => act(s.isFavorite ? "unfavorite" : "favorite", ids),
      },
      {
        label: (s.isBookmark ? "Remove from Bookmarks" : "Add to Bookmarks") + n,
        icon: s.isBookmark ? <BookmarkMinus size={13} /> : <Bookmark size={13} />,
        onSelect: () => act(s.isBookmark ? "unbookmark" : "bookmark", ids),
      },
      {
        label: "Add to collection" + n,
        icon: <FolderPlus size={13} />,
        items: folders.map((c) => ({
          label: `${c.icon ? `${c.icon} ` : ""}${c.name}`,
          icon: !many && s.collections.some((x) => x.id === c.id) ? <Check size={13} /> : undefined,
          onSelect: () =>
            runBulk(ids, { kind: "addToCollection", collectionId: c.id }, `Added to ${c.name}`),
        })),
      },
      ...(s.status === "inbox"
        ? [
            {
              label: "Mark as done" + n,
              icon: <Check size={13} />,
              onSelect: () => act("done", ids),
            },
          ]
        : []),
      {
        label: (s.isArchived ? "Restore from archive" : "Archive") + n,
        icon: s.isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />,
        onSelect: () => act(s.isArchived ? "unarchive" : "archive", ids),
      },
      "separator",
      {
        label: "Delete" + n,
        icon: <Trash2 size={13} />,
        hint: "⌫",
        danger: true,
        onSelect: () => act("delete", ids),
      },
    ];
  };
  const listRef = useRef<HTMLDivElement>(null);
  const columns = useColumns(listRef, mode === "grid" && items.length > 0);

  const renderCard = (s: SaveView, idx: number) => (
    <SaveCard
      key={s.id}
      save={s}
      mode={mode}
      selected={selected.has(s.id)}
      focused={focusIdx === idx}
      tabbable={focusIdx === idx || (focusIdx < 0 && idx === 0)}
      selectionActive={selectionActive}
      onSelect={(e) => toggleSelect(idx, e)}
      onOpenDetail={() => {
        setFocusIdx(idx);
        openSave(s.id);
      }}
      onOpenLink={() => openLink(s)}
      onToggleFavorite={() => act(s.isFavorite ? "unfavorite" : "favorite", [s.id])}
      onContextMenu={menu.open(() => {
        setFocusIdx(idx);
        return entriesFor(s);
      })}
    />
  );

  const toggleSelect = useCallback(
    (idx: number, e?: { shiftKey?: boolean }) => {
      const id = items[idx]?.id;
      if (!id) return;
      setSelected((cur) => {
        const next = new Set(cur);
        if (e?.shiftKey && anchor.current !== null) {
          const [a, b] = [Math.min(anchor.current, idx), Math.max(anchor.current, idx)];
          for (let i = a; i <= b; i++) next.add(items[i]!.id);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchor.current = idx;
    },
    [items],
  );

  const runBulk = useCallback(
    (
      ids: string[],
      action: BulkKind,
      message: string,
      optimistic?: (s: SaveView) => SaveView | null,
    ) => {
      if (optimistic) {
        setItems((cur) =>
          cur.flatMap((s) => (ids.includes(s.id) ? (optimistic(s) ? [optimistic(s)!] : []) : [s])),
        );
      }
      startTransition(async () => {
        const res = await bulkAction(ids, action);
        if (!res.ok) toast(res.error, { tone: "error" });
        else toast(message, { tone: "success" });
        setSelected(new Set());
        setBulkMenu(null);
        router.refresh();
      });
    },
    [router, toast],
  );

  const removesFromView = (kind: string) =>
    (params.view === "inbox" &&
      ["done", "archive", "addToCollection", "bookmark"].includes(kind)) ||
    (params.view === "archive" && kind === "unarchive") ||
    (params.view !== "archive" && kind === "archive") ||
    (params.view === "favorites" && kind === "unfavorite") ||
    kind === "delete";

  const act = useCallback(
    (
      kind:
        | "archive"
        | "unarchive"
        | "favorite"
        | "unfavorite"
        | "bookmark"
        | "unbookmark"
        | "done"
        | "inbox"
        | "delete",
      ids: string[],
    ) => {
      if (!ids.length) return;
      if (kind === "delete") {
        // No "are you sure?": it disappears now and the toast offers Undo for a few seconds.
        if (ids.length > 50 && !confirm(`Delete ${ids.length} saves?`)) return;
        setItems((cur) => cur.filter((s) => !ids.includes(s.id)));
        setSelected(new Set());
        const one = ids.length === 1 ? items.find((s) => s.id === ids[0]) : undefined;
        undoableDelete(ids, one ? `“${one.title}”` : `${ids.length} saves`);
        return;
      }
      const labels: Record<string, string> = {
        archive: "Archived",
        unarchive: "Restored from archive",
        favorite: "Added to favorites",
        unfavorite: "Removed from favorites",
        bookmark: "Added to Bookmarks",
        unbookmark: "Removed from Bookmarks",
        done: "Marked as done",
        inbox: "Moved to inbox",
        delete: "Deleted",
      };
      runBulk(ids, { kind }, `${labels[kind]} · ${ids.length}`, (s) =>
        removesFromView(kind)
          ? null
          : {
              ...s,
              isFavorite: kind === "favorite" ? true : kind === "unfavorite" ? false : s.isFavorite,
              isBookmark: kind === "bookmark" ? true : kind === "unbookmark" ? false : s.isBookmark,
            },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runBulk, params.view, items, undoableDelete],
  );

  const openLink = useCallback((s: SaveView) => {
    void markOpenedAction(s.id);
  }, []);

  // Keyboard: j/k move · x select · enter details · o open · f favorite · e done/archive · z snooze · # delete · esc clear
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        isTyping(e) ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        detailId ||
        paletteOpen ||
        quickSave.open
      )
        return;
      if (document.querySelector("dialog[open]")) return;
      const cur = items[focusIdx];
      const target = selected.size ? [...selected] : cur ? [cur.id] : [];
      switch (e.key) {
        case "j":
        case "ArrowDown":
          if (e.key === "ArrowDown" && focusIdx < 0) return;
          e.preventDefault();
          setFocusIdx((i) => Math.min(items.length - 1, i + 1));
          break;
        case "k":
        case "ArrowUp":
          if (e.key === "ArrowUp" && focusIdx < 0) return;
          e.preventDefault();
          setFocusIdx((i) => Math.max(0, i - 1));
          break;
        case "x":
          if (focusIdx >= 0) toggleSelect(focusIdx, e);
          break;
        case "o":
          if (cur) {
            const href = openHref(cur);
            if (href) {
              window.open(href, "_blank", "noopener,noreferrer");
              openLink(cur);
            }
          }
          break;
        case "r":
          if (cur) router.push(`/read/${cur.id}`);
          break;
        case "f":
          if (cur) act(cur.isFavorite ? "unfavorite" : "favorite", target);
          break;
        case "b":
          if (cur) act(cur.isBookmark ? "unbookmark" : "bookmark", target);
          break;
        case "e":
          act(
            params.view === "inbox" ? "done" : params.view === "archive" ? "unarchive" : "archive",
            target,
          );
          break;
        case "z": {
          // Snooze until tomorrow morning.
          const until = snoozePresets().find((p) => p.label === "Tomorrow")!.until;
          if (target.length)
            runBulk(
              target,
              { kind: "snooze", until },
              `Snoozed until tomorrow · ${target.length}`,
              (s) => (params.view === "inbox" ? null : { ...s, snoozedUntil: until }),
            );
          break;
        }
        case "#":
        case "Delete":
        case "Backspace":
          act("delete", target);
          break;
        case "Escape":
          setSelected(new Set());
          break;
        case "a":
          if (e.shiftKey) setSelected(new Set(items.map((i) => i.id)));
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    items,
    router,
    focusIdx,
    selected,
    detailId,
    paletteOpen,
    quickSave.open,
    toggleSelect,
    act,
    runBulk,
    openLink,
    params.view,
  ]);

  useEffect(() => {
    if (focusIdx < 0) return;
    const el = document.querySelector<HTMLElement>(`[data-save-id="${items[focusIdx]?.id}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
  }, [focusIdx, items]);

  const setSort = (s: SortKey) => {
    const url = new URL(window.location.href);
    url.searchParams.set("sort", s);
    router.replace(url.pathname + url.search);
  };

  const selectedIds = useMemo(() => [...selected], [selected]);

  return (
    <div>
      {menu.element}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="eyebrow">
          {formatCount(initial.total)} {initial.total === 1 ? "item" : "items"}
        </span>
        {toolbarExtra}
        <div className="ml-auto flex items-center gap-2">
          {showSort && (
            <select
              aria-label="Sort"
              value={sort ?? (params.q ? "relevance" : "newest")}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-7 rounded-md border border-border bg-surface-2 px-2 font-mono text-2xs text-fg-2 hover:border-border-strong"
            >
              {params.q && <option value="relevance">Relevance</option>}
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="opened">Recently opened</option>
              <option value="title">Title A–Z</option>
            </select>
          )}
          <div
            role="radiogroup"
            aria-label="View"
            className="flex rounded-md border border-border bg-surface-2 p-0.5"
          >
            {(
              [
                ["grid", LayoutGrid, "Grid"],
                ["list", List, "List"],
                ["dense", Rows3, "Dense"],
              ] as const
            ).map(([m, Icon, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                aria-label={`${label} view`}
                title={`${label} view`}
                onClick={() => setMode(m)}
                className={cn(
                  "flex size-6 items-center justify-center rounded",
                  mode === m ? "bg-surface-3 text-fg" : "text-muted hover:text-fg-2",
                )}
              >
                <Icon size={13} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {interpreted && params.q && <Interpreted original={params.q} query={interpreted} />}
      {items.length === 0 ? (
        empty
      ) : (
        <div
          ref={listRef}
          role="listbox"
          aria-multiselectable
          aria-label="Saves"
          className={cn(
            mode === "grid" && "flex items-start gap-3",
            mode === "list" && "flex flex-col gap-0.5",
            mode === "dense" && "overflow-hidden rounded-lg border border-border",
          )}
        >
          {mode === "grid"
            ? // Masonry: round-robin into columns so appended pages never reshuffle cards.
              Array.from({ length: columns }, (_, col) => (
                <div key={col} role="presentation" className="flex min-w-0 flex-1 flex-col gap-3">
                  {items.map((s, idx) => (idx % columns === col ? renderCard(s, idx) : null))}
                </div>
              ))
            : items.map((s, idx) => renderCard(s, idx))}
        </div>
      )}
      <div ref={sentinel} aria-hidden className="h-px" />
      {loadingMore && (
        <div className="flex justify-center py-6 text-muted">
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}

      {selectionActive && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="fixed bottom-5 left-1/2 z-30 flex max-w-[calc(100vw-32px)] -translate-x-1/2 animate-pop flex-wrap items-center gap-1 rounded-xl border border-border-strong bg-surface-2 p-1.5 shadow-elevated md:ml-30"
        >
          <span className="px-2 font-mono text-2xs text-fg-2">{selected.size} selected</span>
          {params.view === "inbox" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => act("done", selectedIds)}
              disabled={pending}
            >
              <Check size={13} /> Done
            </Button>
          )}
          <SnoozeMenu
            placement="up"
            onSnooze={(until) =>
              runBulk(
                selectedIds,
                { kind: "snooze", until },
                `Snoozed · ${selectedIds.length}`,
                (s) => (params.view === "inbox" ? null : { ...s, snoozedUntil: until }),
              )
            }
            className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-fg-2 hover:bg-surface-2 hover:text-fg"
          >
            <AlarmClock size={13} /> Snooze
          </SnoozeMenu>
          <div className="relative">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setBulkMenu(bulkMenu === "collection" ? null : "collection")}
            >
              <FolderPlus size={13} /> Collection
            </Button>
            {bulkMenu === "collection" && (
              <div className="absolute bottom-9 left-0 max-h-64 w-56 overflow-y-auto rounded-lg border border-border-strong bg-surface-2 p-1 shadow-elevated">
                {collections.filter((c) => !c.smart).length === 0 && (
                  <p className="p-2 text-xs text-muted">No manual collections yet.</p>
                )}
                {collections
                  .filter((c) => !c.smart)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3"
                      onClick={() =>
                        runBulk(
                          selectedIds,
                          { kind: "addToCollection", collectionId: c.id },
                          `Added to ${c.name}`,
                          (s) =>
                            params.view === "inbox"
                              ? null
                              : {
                                  ...s,
                                  collections: [
                                    ...s.collections,
                                    { id: c.id, name: c.name, icon: c.icon },
                                  ],
                                },
                        )
                      }
                    >
                      <span className="w-4 text-center">{c.icon ?? "▫︎"}</span>
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
          <div className="relative">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setBulkMenu(bulkMenu === "tag" ? null : "tag")}
            >
              <Hash size={13} /> Tag
            </Button>
            {bulkMenu === "tag" && (
              <form
                className="absolute bottom-9 left-0 w-56 rounded-lg border border-border-strong bg-surface-2 p-2 shadow-elevated"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (tagDraft.trim())
                    runBulk(
                      selectedIds,
                      { kind: "addTag", tag: tagDraft },
                      `Tagged #${tagDraft.replace(/^#/, "")}`,
                    );
                  setTagDraft("");
                }}
              >
                <input
                  autoFocus
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  placeholder="Add tag…"
                  className="input h-7 text-xs"
                  aria-label="Tag name"
                />
              </form>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => act("favorite", selectedIds)}>
            <Star size={13} /> Favorite
          </Button>
          <Button size="sm" variant="ghost" onClick={() => act("bookmark", selectedIds)}>
            <Bookmark size={13} /> Bookmark
          </Button>
          {params.view === "archive" ? (
            <Button size="sm" variant="ghost" onClick={() => act("unarchive", selectedIds)}>
              <ArchiveRestore size={13} /> Restore
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => act("archive", selectedIds)}>
              <Archive size={13} /> Archive
            </Button>
          )}
          {params.view !== "inbox" && params.view !== "archive" && (
            <Button size="sm" variant="ghost" onClick={() => act("inbox", selectedIds)}>
              <Inbox size={13} /> Inbox
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-danger hover:text-danger"
            onClick={() => act("delete", selectedIds)}
          >
            <Trash2 size={13} /> Delete
          </Button>
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => setSelected(new Set())}
            className="p-1.5 text-muted hover:text-fg"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
