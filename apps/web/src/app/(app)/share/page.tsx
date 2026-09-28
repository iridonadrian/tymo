import { ShareHandler } from "@/components/share-handler";

export const metadata = { title: "Save" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.slice(0, 20_000);

/**
 * Web Share Target (manifest.ts). Never saves on GET — any site could link here — it only
 * opens the quick-save dialog prefilled, and the user confirms.
 */
export default async function SharePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return (
    <ShareHandler
      title={first(sp.title)}
      text={first(sp.text)}
      url={first(sp.url)}
      popup={first(sp.popup) === "1"}
    />
  );
}
