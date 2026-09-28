import { Fragment } from "react";
import { highlightRanges, safeHref } from "@tymo/core";
import type { Block, Run } from "@tymo/core/reader";
import { imageSrc } from "@/lib/format";
import { ReaderImage } from "./reader-shell";

/**
 * Renders reader blocks as ordinary React elements. The blocks are plain data extracted from
 * an untrusted page, so there is no HTML to inject; links still go through safeHref() and
 * images through the /img proxy (no third-party requests or referrers from the browser).
 */
export function ReaderBlocks({ blocks, quotes = [] }: { blocks: Block[]; quotes?: string[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} quotes={quotes} />
      ))}
    </>
  );
}

function BlockView({ block: b, quotes }: { block: Block; quotes: string[] }) {
  switch (b.type) {
    case "heading": {
      const H = `h${b.level}` as "h2" | "h3" | "h4";
      return <H>{b.text}</H>;
    }
    case "paragraph":
      return (
        <p>
          <Runs runs={b.runs} quotes={quotes} />
        </p>
      );
    case "list": {
      const L = b.ordered ? "ol" : "ul";
      return (
        <L>
          {b.items.map((item, i) => (
            <li key={i}>
              <Runs runs={item} quotes={quotes} />
            </li>
          ))}
        </L>
      );
    }
    case "quote":
      return (
        <blockquote>
          <Runs runs={b.runs} quotes={quotes} />
        </blockquote>
      );
    case "code":
      return (
        <pre data-lang={b.lang}>
          <code>{b.text}</code>
        </pre>
      );
    case "image": {
      const src = imageSrc(b.src);
      if (!src) return null;
      return <ReaderImage src={src} alt={b.alt ?? ""} caption={b.caption} />;
    }
    case "table": {
      const [head, ...rest] = b.header ? b.rows : [undefined, ...b.rows];
      return (
        <div className="reader-table">
          <table>
            {head && (
              <thead>
                <tr>
                  {head.map((c, i) => (
                    <th key={i}>{c}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rest.map((r, i) => (
                <tr key={i}>
                  {r?.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "rule":
      return <hr />;
    default:
      return null;
  }
}

type MarkedRun = Run & { mark?: true };

/** Splits runs at highlight boundaries so saved passages can be wrapped in <mark>. */
function markRuns(runs: Run[], quotes: string[]): MarkedRun[] {
  if (!quotes.length) return runs;
  const ranges = highlightRanges(runs.map((r) => r.text).join(""), quotes);
  if (!ranges.length) return runs;
  const out: MarkedRun[] = [];
  let offset = 0;
  for (const r of runs) {
    const start = offset;
    const end = offset + r.text.length;
    offset = end;
    const cuts = new Set([start, end]);
    for (const [a, b] of ranges) {
      if (a > start && a < end) cuts.add(a);
      if (b > start && b < end) cuts.add(b);
    }
    const points = [...cuts].sort((x, y) => x - y);
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i]!, points[i + 1]!];
      const marked = ranges.some(([x, y]) => a >= x && b <= y);
      out.push({
        ...r,
        text: r.text.slice(a - start, b - start),
        ...(marked ? { mark: true } : {}),
      });
    }
  }
  return out;
}

function Runs({ runs, quotes }: { runs: Run[]; quotes: string[] }) {
  return (
    <>
      {markRuns(runs, quotes).map((r, i) => {
        let node: React.ReactNode = r.text;
        if (r.code) node = <code>{node}</code>;
        if (r.italic) node = <em>{node}</em>;
        if (r.bold) node = <strong>{node}</strong>;
        const href = safeHref(r.href);
        if (href)
          node = (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {node}
            </a>
          );
        if ((r as MarkedRun).mark) node = <mark>{node}</mark>;
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

/** Plain text (notes, extracted text, post captions) as paragraphs, keeping line breaks. */
export function TextParagraphs({ text, max = 400 }: { text: string; max?: number }) {
  const paras = text
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  // Extracted page text has one line per block; treat single lines as paragraphs then.
  const parts =
    paras.length === 1 && text.includes("\n") ? text.split("\n").filter((l) => l.trim()) : paras;
  return (
    <>
      {parts.slice(0, max).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </>
  );
}
