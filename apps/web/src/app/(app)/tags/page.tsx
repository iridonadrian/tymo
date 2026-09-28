import { Hash } from "lucide-react";
import { listTags } from "@/server/tags";
import { EmptyState, PageHeader } from "@/components/ui";
import { TagTable } from "@/components/tag-table";

export const metadata = { title: "Tags" };

export default async function TagsPage() {
  const tags = await listTags();
  return (
    <>
      <PageHeader eyebrow="Lightweight labels" title="Tags">
        Type <code className="font-mono text-fg">#tag</code> or{" "}
        <code className="font-mono text-fg">tag:name</code> in search. Rename a tag to an existing
        name to merge them.
      </PageHeader>
      {tags.length === 0 ? (
        <EmptyState icon={<Hash size={18} />} title="No tags yet">
          Add tags when saving — no setup needed.
        </EmptyState>
      ) : (
        <TagTable tags={tags} />
      )}
    </>
  );
}
