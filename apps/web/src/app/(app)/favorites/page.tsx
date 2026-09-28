import { Star } from "lucide-react";
import { ListPage, type SearchParams } from "@/components/list-page";
import { EmptyState } from "@/components/ui";

export const metadata = { title: "Favorites" };

export default function FavoritesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ListPage
      searchParams={searchParams}
      base={{ view: "favorites" }}
      eyebrow="Starred"
      title="Favorites"
      empty={
        <EmptyState icon={<Star size={18} />} title="No favorites yet">
          Star a save (or press <kbd className="kbd">F</kbd>) to keep it close.
        </EmptyState>
      }
    />
  );
}
