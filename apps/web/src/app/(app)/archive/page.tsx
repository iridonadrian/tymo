import { Archive } from "lucide-react";
import { ListPage, type SearchParams } from "@/components/list-page";
import { EmptyState } from "@/components/ui";

export const metadata = { title: "Archive" };

export default function ArchivePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ListPage
      searchParams={searchParams}
      base={{ view: "archive" }}
      eyebrow="Out of sight"
      title="Archive"
      description="Archived saves are hidden everywhere else but stay searchable here."
      empty={<EmptyState icon={<Archive size={18} />} title="Archive is empty" />}
    />
  );
}
