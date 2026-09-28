"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Archive,
  Bookmark,
  CopyCheck,
  Folder,
  Hash,
  Inbox,
  Layers,
  Library,
  Menu,
  Plus,
  Search,
  Settings,
  Shuffle,
  Sparkles,
  Star,
  X,
  History,
} from "lucide-react";
import { cn, formatCount } from "@/lib/format";
import { Logo } from "./logo";
import { useApp } from "./app-context";

export interface SidebarCounts {
  saves: number;
  inbox: number;
  favorites: number;
  bookmarks: number;
  sessions: number;
  archived: number;
  tags: number;
}

function NavItem({
  href,
  icon,
  label,
  count,
  exact,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-[30px] items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors",
        active
          ? "bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--color-border)]"
          : "text-fg-2 hover:bg-surface-2/60 hover:text-fg",
      )}
    >
      <span
        className={cn("shrink-0", active ? "text-accent-ink" : "text-muted group-hover:text-fg-2")}
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="font-mono text-2xs text-muted">{formatCount(count)}</span>
      )}
    </Link>
  );
}

export function Sidebar({ counts }: { counts: SidebarCounts }) {
  const { collections, openQuickSave, setPaletteOpen, openCollectionDialog } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname]);

  const roots = collections.filter(
    (c) => !c.parentId || !collections.some((p) => p.id === c.parentId),
  );
  const children = (id: string) => collections.filter((c) => c.parentId === id);

  const nav = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Link href="/" className="flex items-center gap-2.5 rounded-md" aria-label="Tymo home">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">Tymo</span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="ml-auto text-fg-2 md:hidden"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex gap-2 px-3 pb-3">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex h-8 flex-1 items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 text-left text-sm text-muted hover:border-border-strong"
        >
          <Search size={14} />
          <span className="flex-1">Search</span>
          <kbd className="kbd touch-hidden">⌘K</kbd>
        </button>
        <button
          type="button"
          onClick={() => openQuickSave()}
          aria-label="New save"
          title="New save (N)"
          className="flex size-8 items-center justify-center rounded-lg bg-accent text-on-accent hover:bg-accent-hover"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="space-y-0.5">
          <NavItem href="/" exact icon={<Sparkles size={15} />} label="Home" />
          <NavItem href="/inbox" icon={<Inbox size={15} />} label="Inbox" count={counts.inbox} />
          <NavItem
            href="/saves"
            icon={<Library size={15} />}
            label="All Saves"
            count={counts.saves}
          />
          <NavItem
            href="/bookmarks"
            icon={<Bookmark size={15} />}
            label="Bookmarks"
            count={counts.bookmarks}
          />
          <NavItem
            href="/favorites"
            icon={<Star size={15} />}
            label="Favorites"
            count={counts.favorites}
          />
          <NavItem
            href="/sessions"
            icon={<History size={15} />}
            label="Sessions"
            count={counts.sessions}
          />
          <NavItem href="/serendipity" icon={<Shuffle size={15} />} label="Serendipity" />
          <NavItem href="/tags" icon={<Hash size={15} />} label="Tags" count={counts.tags} />
          <NavItem
            href="/archive"
            icon={<Archive size={15} />}
            label="Archive"
            count={counts.archived}
          />
          <NavItem href="/duplicates" icon={<CopyCheck size={15} />} label="Duplicates" />
        </div>

        <div className="mt-6 mb-1.5 flex items-center justify-between px-2.5">
          <Link href="/collections" className="eyebrow hover:text-fg-2">
            Collections
          </Link>
          <button
            type="button"
            onClick={() => openCollectionDialog()}
            aria-label="New collection"
            className="text-muted hover:text-fg"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="space-y-0.5">
          {roots.length === 0 && (
            <button
              type="button"
              onClick={() => openCollectionDialog()}
              className="px-2.5 py-1 text-left text-xs text-muted hover:text-fg-2"
            >
              Create your first collection
            </button>
          )}
          {roots.map((c) => (
            <div key={c.id}>
              <NavItem
                href={`/collections/${c.id}`}
                icon={
                  c.icon ? (
                    <span className="inline-block w-[15px] text-center text-[13px] leading-none">
                      {c.icon}
                    </span>
                  ) : c.smart ? (
                    <Layers size={15} />
                  ) : (
                    <Folder size={15} />
                  )
                }
                label={c.name}
                count={c.count}
              />
              {children(c.id).length > 0 && (
                <div className="ml-4 border-l border-border pl-1.5">
                  {children(c.id).map((k) => (
                    <NavItem
                      key={k.id}
                      href={`/collections/${k.id}`}
                      icon={
                        k.icon ? (
                          <span className="inline-block w-[15px] text-center text-[13px] leading-none">
                            {k.icon}
                          </span>
                        ) : (
                          <Folder size={14} />
                        )
                      }
                      label={k.name}
                      count={k.count}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="px-3 py-3">
        <NavItem href="/settings" icon={<Settings size={15} />} label="Settings" />
      </div>
    </nav>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="text-fg-2"
        >
          <Menu size={18} />
        </button>
        <Logo size={20} />
        <span className="font-semibold">Tymo</span>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="ml-auto text-fg-2"
          aria-label="Search"
        >
          <Search size={18} />
        </button>
        <button
          type="button"
          onClick={() => openQuickSave()}
          className="text-accent-ink"
          aria-label="New save"
        >
          <Plus size={20} />
        </button>
      </div>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 bg-bg md:block">{nav}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal aria-label="Menu">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 animate-slide border-r border-border bg-bg">
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
