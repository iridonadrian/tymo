import { listSaves, type ListParams, type SortKey } from "@/server/saves";
import { SaveList } from "./save-list";
import { ListSearch } from "./list-search";
import { PageHeader } from "./ui";

const SORTS: SortKey[] = ["newest", "oldest", "title", "opened", "relevance"];

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function ListPage({
  searchParams,
  base,
  eyebrow,
  title,
  description,
  empty,
  actions,
}: {
  searchParams: SearchParams;
  base: ListParams;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  empty: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 500) : "";
  const sortRaw = typeof sp.sort === "string" ? sp.sort : undefined;
  const sort = SORTS.includes(sortRaw as SortKey) ? (sortRaw as SortKey) : undefined;
  const natural = sp.exact !== "1";
  const params: ListParams = { ...base, q: q || undefined, sort, natural };
  const initial = await listSaves({ ...params, limit: 60 });
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} actions={actions}>
        {description}
      </PageHeader>
      <SaveList
        initial={initial}
        params={params}
        empty={empty}
        toolbarExtra={<ListSearch key="search" initial={q} />}
        interpreted={initial.interpreted}
      />
    </>
  );
}
