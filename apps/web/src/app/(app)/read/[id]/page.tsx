import { notFound } from "next/navigation";
import { SAVE_TYPE_LABELS } from "@tymo/core";
import { readingMinutes } from "@tymo/core/reader";
import { getReaderView, highlightsFor } from "@/server/saves";
import { ReaderHighlights, ReaderImage, ReaderShell } from "@/components/reader-shell";
import { ReaderBlocks, TextParagraphs } from "@/components/reader-blocks";
import { Favicon } from "@/components/favicon";
import { imageSrc } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const s = await getReaderView((await params).id);
  return { title: s?.title ?? "Reader" };
}

function formatPublished(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;
}

export default async function ReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getReaderView((await params).id);
  if (!s) notFound();

  const highlights = await highlightsFor(s.id);
  const quotes = highlights.map((h) => h.text);
  const isPost = s.type === "social";
  const blocks = s.reader?.blocks ?? [];
  // Posts: the caption (og:description) is the content; a long thread may also extract.
  const article = blocks.length > 0 && !(isPost && (s.reader?.words ?? 0) < 120);
  const fallback = !article ? (s.type === "note" ? s.body : isPost ? s.description : s.text) : null;
  const words = article ? s.reader!.words : (fallback?.split(/\s+/).filter(Boolean).length ?? 0);
  const hero =
    imageSrc(s.imageUrl) && !blocks.some((b) => b.type === "image" && b.src === s.imageUrl)
      ? imageSrc(s.imageUrl)
      : undefined;
  const published = formatPublished(s.publishedAt);
  const byline = [s.author, s.siteName && s.siteName !== s.author ? s.siteName : null, published]
    .filter(Boolean)
    .join(" · ");
  const empty = !article && !fallback;

  return (
    <ReaderShell
      saveId={s.id}
      url={s.url}
      snapshotId={s.snapshotId}
      pending={s.metadataStatus === "pending"}
      empty={empty}
    >
      <header className="reader-head">
        <div className="eyebrow flex items-center gap-2">
          <Favicon url={s.faviconUrl} domain={s.domain} type={s.type} size={14} />
          <span className="truncate">{s.domain ?? SAVE_TYPE_LABELS[s.type]}</span>
          {words > 60 && <span>· {readingMinutes(words)} min read</span>}
        </div>
        <h1 className={isPost ? "reader-post-title" : undefined}>{s.title}</h1>
        {s.description && article && !isPost && <p className="reader-lede">{s.description}</p>}
        {byline && <p className="reader-byline">{byline}</p>}
      </header>

      {s.notes && (
        <aside className="reader-notes">
          <div className="eyebrow mb-1">Your notes</div>
          <p>{s.notes}</p>
        </aside>
      )}

      <div className={isPost && !article ? "reader-body reader-post" : "reader-body"}>
        {hero && !isPost && <ReaderImage src={hero} alt="" />}
        {article ? (
          <ReaderBlocks blocks={blocks} quotes={quotes} />
        ) : (
          fallback && <TextParagraphs text={fallback} />
        )}
        {hero && isPost && <ReaderImage src={hero} alt="" />}
      </div>
      <ReaderHighlights items={highlights} />
    </ReaderShell>
  );
}
