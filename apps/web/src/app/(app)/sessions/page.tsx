import Link from "next/link";
import { History } from "lucide-react";
import { listSessions } from "@/server/sessions";
import { fullDate } from "@/lib/format";
import { EmptyState, PageHeader, Time } from "@/components/ui";
import { Favicon } from "@/components/favicon";

export const metadata = { title: "Sessions" };

export default async function SessionsPage() {
  const sessions = await listSessions(200);
  return (
    <>
      <PageHeader eyebrow="Snapshots in time" title="Sessions">
        A session is every tab you were researching together at one moment. Save it from the
        extension, close the tabs, restore it later.
      </PageHeader>
      {sessions.length === 0 ? (
        <EmptyState icon={<History size={18} />} title="No sessions yet">
          Open the Tymo extension and choose <strong>Save session</strong> (or press{" "}
          <kbd className="kbd">Alt</kbd>+<kbd className="kbd">Shift</kbd>+
          <kbd className="kbd">E</kbd>). Then close the saved tabs with one click.
        </EmptyState>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border">
          {sessions.map((s) => (
            <li key={s.id} className="border-b border-border last:border-0">
              <Link
                href={`/sessions/${s.id}`}
                className="flex items-center gap-4 bg-surface px-4 py-3 transition-colors hover:bg-surface-2/60"
              >
                <History size={16} className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-2xs text-muted">
                    <span title={fullDate(s.createdAt)}>
                      <Time ts={s.createdAt} /> AGO
                    </span>
                    <span>{s.tabCount} TABS</span>
                    {s.windows > 1 && <span>{s.windows} WINDOWS</span>}
                    {s.domains.length > 0 && (
                      <span className="truncate">{s.domains.join(" · ")}</span>
                    )}
                  </div>
                </div>
                <div className="hidden -space-x-1 sm:flex">
                  {s.favicons.map((f) => (
                    <Favicon key={f} url={f} size={18} className="ring-2 ring-surface" />
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
