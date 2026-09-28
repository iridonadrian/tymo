import { CopyCheck } from "lucide-react";
import { findDuplicates } from "@/server/duplicates";
import { embeddingStatus } from "@/server/embeddings";
import { EmptyState, PageHeader } from "@/components/ui";
import { DuplicateList } from "@/components/duplicate-list";

export const metadata = { title: "Duplicates" };

export default async function DuplicatesPage() {
  const [pairs, emb] = await Promise.all([findDuplicates(), embeddingStatus()]);
  return (
    <div className="max-w-5xl">
      <PageHeader eyebrow="Library hygiene" title="Duplicates">
        Saves that redirect to the same page or share a title
        {emb.enabled ? ", plus near-identical content found by semantic search" : ""}. Merging keeps
        tags, collections, notes, files and session history.
      </PageHeader>
      {pairs.length === 0 ? (
        <EmptyState icon={<CopyCheck size={18} />} title="No duplicates found">
          Identical links are merged automatically when you save them.
          {!emb.enabled &&
            " Turn on semantic search in Settings → AI to also catch near-duplicates."}
        </EmptyState>
      ) : (
        <DuplicateList pairs={pairs} />
      )}
    </div>
  );
}
