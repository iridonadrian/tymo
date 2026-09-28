import Link from "next/link";
import { Folder, Layers } from "lucide-react";
import { describeRules } from "@tymo/core";
import { listCollections } from "@/server/collections";
import { formatCount } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui";
import { NewCollectionButtons } from "@/components/collection-actions";

export const metadata = { title: "Collections" };

export default async function CollectionsPage() {
  const collections = await listCollections();
  const byId = new Map(collections.map((c) => [c.id, c]));
  return (
    <>
      <PageHeader eyebrow="Long-term topics" title="Collections" actions={<NewCollectionButtons />}>
        Manual collections hold what you file into them. Smart collections fill themselves from
        rules.
      </PageHeader>
      {collections.length === 0 ? (
        <EmptyState icon={<Folder size={18} />} title="No collections yet">
          Try “Cybersecurity”, “AI Tools”, “Travel”, or a smart collection like “everything tagged
          #read-later”.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {collections.map((c) => (
            <Link
              key={c.id}
              href={`/collections/${c.id}`}
              className="group rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-base">
                  {c.icon ??
                    (c.smart ? (
                      <Layers size={15} className="text-fg-2" />
                    ) : (
                      <Folder size={15} className="text-fg-2" />
                    ))}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="font-mono text-2xs text-muted">
                    {formatCount(c.count)} SAVES{c.smart ? " · SMART" : ""}
                    {c.parentId && byId.get(c.parentId)
                      ? ` · IN ${byId.get(c.parentId)!.name.toUpperCase()}`
                      : ""}
                  </div>
                </div>
              </div>
              {(c.description || c.rules) && (
                <p className="mt-3 line-clamp-2 text-xs text-fg-2">
                  {c.description ?? (c.rules ? describeRules(c.rules) : "")}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
