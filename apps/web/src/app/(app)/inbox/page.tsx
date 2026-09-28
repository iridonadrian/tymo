import Link from "next/link";
import { Inbox } from "lucide-react";
import { libraryStats } from "@/server/saves";
import { ListPage, type SearchParams } from "@/components/list-page";
import { EmptyState } from "@/components/ui";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  const { snoozed } = await libraryStats();
  return (
    <ListPage
      searchParams={searchParams}
      base={{ view: "inbox" }}
      eyebrow="Unsorted"
      title="Inbox"
      description={
        <>
          New saves land here. File them into a collection or press <kbd className="kbd">E</kbd> to
          mark done. Select with <kbd className="kbd">X</kbd>, move with{" "}
          <kbd className="kbd">J</kbd>/<kbd className="kbd">K</kbd>.
          {snoozed > 0 && (
            <>
              {" "}
              <Link href="/saves?q=is:snoozed" className="text-accent-ink hover:underline">
                {snoozed} snoozed
              </Link>{" "}
              will come back later.
            </>
          )}
        </>
      }
      empty={
        <EmptyState icon={<Inbox size={18} />} title="Inbox zero">
          Everything is organized. New saves will show up here.
        </EmptyState>
      }
    />
  );
}
