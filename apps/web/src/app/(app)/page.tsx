import Link from "next/link";
import { ArrowRight, Folder, History, Inbox, Layers } from "lucide-react";
import { libraryStats, listSaves, recentlyOpened, rediscover } from "@/server/saves";
import { listCollections } from "@/server/collections";
import { listSessions } from "@/server/sessions";
import { formatCount } from "@/lib/format";
import { DashboardActions, DashboardSearch } from "@/components/dashboard-client";
import { MiniSaveList } from "@/components/mini-save-list";
import { EmptyState, Time } from "@/components/ui";
import { Favicon } from "@/components/favicon";
import { CodeField } from "@/components/code-field";
import { HeaderRule } from "@/components/ui";

export const metadata = { title: "Your Memory" };

function Section({
  title,
  href,
  children,
}: {
  title: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="eyebrow">{title}</h2>
        {href && (
          <Link
            href={href}
            className="flex items-center gap-1 font-mono text-2xs text-muted hover:text-fg-2"
          >
            View all <ArrowRight size={11} />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export default async function Dashboard() {
  const [stats, recent, opened, collections, sessions, inbox, forgotten] = await Promise.all([
    libraryStats(),
    listSaves({ limit: 8 }),
    recentlyOpened(5),
    listCollections(),
    listSessions(4),
    listSaves({ view: "inbox", limit: 1 }),
    rediscover(4),
  ]);
  const empty = stats.saves === 0 && stats.archived === 0;

  return (
    <div className="space-y-12">
      <header className="relative -mx-4 -mt-6 overflow-hidden px-4 pt-14 pb-10 sm:-mx-6 sm:px-6 md:-mt-8 lg:-mx-10 lg:px-10">
        <CodeField />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-panel/70 via-panel/20 to-transparent"
        />
        <HeaderRule />
        <div className="relative">
          <div className="eyebrow mb-2 flex flex-wrap gap-x-5 gap-y-1">
            <span>{formatCount(stats.saves)} saves</span>
            <span>{formatCount(stats.collections)} collections</span>
            <span>{formatCount(stats.sessions)} sessions</span>
            {stats.inbox > 0 && (
              <span className="text-accent-ink">{formatCount(stats.inbox)} in inbox</span>
            )}
          </div>
          <h1 className="text-5xl leading-none font-medium tracking-tight sm:text-[64px]">
            Your Memory
          </h1>
          <p className="mt-3 text-base text-muted">Save it. Close it. Find it later.</p>
          <div className="mt-8 flex flex-col gap-3 lg:flex-row lg:items-center">
            <DashboardSearch />
            <DashboardActions />
          </div>
        </div>
      </header>

      {empty ? (
        <EmptyState icon={<Inbox size={18} />} title="Nothing saved yet">
          Press <kbd className="kbd">N</kbd> or paste a link anywhere to save it. Install the
          browser extension to save tabs and whole sessions, or{" "}
          <Link href="/settings#import" className="text-accent-ink hover:underline">
            import your bookmarks
          </Link>
          .
        </EmptyState>
      ) : (
        <>
          {inbox.total > 0 && (
            <Link
              href="/inbox"
              className="card flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:border-border-strong"
            >
              <Inbox size={16} className="text-fg-2" />
              <span className="flex-1">
                <strong className="font-medium">{formatCount(inbox.total)}</strong>{" "}
                {inbox.total === 1 ? "save is" : "saves are"} waiting in your Inbox
              </span>
              <span className="font-mono text-2xs text-fg-2">ORGANIZE →</span>
            </Link>
          )}

          <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Section title="Recent saves" href="/saves">
              <MiniSaveList saves={recent.items} />
            </Section>
            <div className="min-w-0 space-y-12">
              <Section title="Continue where you left off">
                {opened.length ? (
                  <MiniSaveList saves={opened} compact />
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted">
                    Saves you open will show up here.
                  </p>
                )}
              </Section>
              {forgotten.length > 0 && (
                <Section title="Rediscover">
                  <MiniSaveList saves={forgotten} compact />
                </Section>
              )}
            </div>
          </div>

          <Section title="Collections" href="/collections">
            {collections.length ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
                {collections.slice(0, 12).map((c) => (
                  <Link
                    key={c.id}
                    href={`/collections/${c.id}`}
                    className="card group flex items-center gap-3 px-3 py-2.5 transition-colors hover:border-border-strong"
                  >
                    <span className="flex size-8 items-center justify-center rounded-md border border-border bg-surface-2 text-sm">
                      {c.icon ??
                        (c.smart ? (
                          <Layers size={14} className="text-fg-2" />
                        ) : (
                          <Folder size={14} className="text-fg-2" />
                        ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="font-mono text-2xs text-muted">
                        {formatCount(c.count)} {c.smart ? "· SMART" : ""}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted">
                Collections group saves by long-term topic — create one from the sidebar.
              </p>
            )}
          </Section>

          <Section title="Recent sessions" href="/sessions">
            {sessions.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {sessions.map((s) => (
                  <Link
                    key={s.id}
                    href={`/sessions/${s.id}`}
                    className="card flex items-center gap-3 px-3 py-2.5 transition-colors hover:border-border-strong"
                  >
                    <History size={15} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.name}</span>
                      <span className="flex items-center gap-2 font-mono text-2xs text-muted">
                        {s.tabCount} tabs · <Time ts={s.createdAt} />
                      </span>
                    </span>
                    <span className="flex -space-x-1">
                      {s.favicons.slice(0, 4).map((f) => (
                        <Favicon key={f} url={f} size={16} className="ring-2 ring-surface" />
                      ))}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted">
                Use the browser extension’s “Save session” to snapshot every open tab, close them,
                and restore them later.
              </p>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
