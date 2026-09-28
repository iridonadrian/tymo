import { Library } from "lucide-react";
import { ListPage, type SearchParams } from "@/components/list-page";
import { EmptyState } from "@/components/ui";

export const metadata = { title: "All Saves" };

export default async function SavesPage({ searchParams }: { searchParams: SearchParams }) {
  const q = (await searchParams).q;
  return (
    <ListPage
      searchParams={searchParams}
      base={{ view: "all" }}
      eyebrow={q ? "Search" : "Library"}
      title={q ? `Results for “${String(q).slice(0, 80)}”` : "All Saves"}
      empty={
        <EmptyState icon={<Library size={18} />} title={q ? "No matches" : "Nothing here yet"}>
          {q
            ? "Try fewer words, or filters like tag:osint, domain:github.com, type:video, is:fav, after:2026-01-01."
            : "Press N to save something."}
        </EmptyState>
      }
    />
  );
}
