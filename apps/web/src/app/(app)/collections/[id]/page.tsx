import Link from "next/link";
import { notFound } from "next/navigation";
import { Folder } from "lucide-react";
import { describeRules } from "@tymo/core";
import { getCollection, listCollections } from "@/server/collections";
import { ListPage, type SearchParams } from "@/components/list-page";
import { EmptyState } from "@/components/ui";
import { CollectionHeaderActions } from "@/components/collection-actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const c = await getCollection((await params).id);
  return { title: c?.name ?? "Collection" };
}

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const all = await listCollections();
  const c = all.find((x) => x.id === id);
  if (!c) notFound();
  const children = all.filter((x) => x.parentId === c.id);
  const parent = c.parentId ? all.find((x) => x.id === c.parentId) : null;

  return (
    <ListPage
      searchParams={searchParams}
      base={{ view: "all", collectionId: c.id }}
      eyebrow={
        <span>
          {parent ? (
            <Link href={`/collections/${parent.id}`} className="hover:text-fg-2">
              {parent.name} /{" "}
            </Link>
          ) : null}
          {c.smart ? "Smart collection" : "Collection"}
        </span>
      }
      title={
        <span className="flex items-center gap-2.5">
          {c.icon && <span>{c.icon}</span>}
          {c.name}
        </span>
      }
      description={
        <>
          {c.description && <span className="block">{c.description}</span>}
          {c.rules && (
            <span className="mt-1 block font-mono text-2xs text-muted">
              RULES: {describeRules(c.rules)}
            </span>
          )}
          {children.length > 0 && (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {children.map((k) => (
                <Link
                  key={k.id}
                  href={`/collections/${k.id}`}
                  className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-xs text-fg-2 hover:text-fg"
                >
                  {k.icon ?? <Folder size={11} />} {k.name}{" "}
                  <span className="font-mono text-2xs text-muted">{k.count}</span>
                </Link>
              ))}
            </span>
          )}
        </>
      }
      actions={<CollectionHeaderActions collection={c} />}
      empty={
        <EmptyState icon={<Folder size={18} />} title="This collection is empty">
          {c.smart
            ? "Nothing matches its rules yet."
            : "Select saves anywhere and use “Collection” to file them here, or press N while on this page."}
        </EmptyState>
      }
    />
  );
}
