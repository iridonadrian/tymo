import { listBookmarks } from "@/server/saves";
import { BookmarksView } from "@/components/bookmarks-view";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Bookmarks" };

export default async function BookmarksPage() {
  const items = await listBookmarks();
  return (
    <>
      <PageHeader eyebrow="Library" title="Bookmarks">
        The sites you come back to, without keeping them open as tabs. Links open in a new tab; make
        this page your browser’s start page for a quick launcher.
      </PageHeader>
      <BookmarksView items={items} />
    </>
  );
}
