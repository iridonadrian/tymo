/**
 * Highlights: a passage of a page saved as its own "quote" card. Helpers to link back to the
 * exact passage (URL text fragments) and to find saved passages again inside article text.
 */

const norm = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** Short title for a quote card: the first dozen words. */
export function quoteTitle(text: string, words = 12): string {
  const all = norm(text).split(" ").filter(Boolean);
  const head = all.slice(0, words).join(" ");
  return all.length > words ? `${head}…` : head || "Highlight";
}

const encodeFragment = (s: string) =>
  encodeURIComponent(s).replace(/-/g, "%2D").replace(/'/g, "%27");

/**
 * The page URL with a text fragment (`#:~:text=start,end`) so browsers scroll to and
 * highlight the passage. Long passages use their first and last few words.
 */
export function textFragmentUrl(url: string, quote: string): string {
  const u = new URL(url);
  const words = norm(quote).split(" ").filter(Boolean);
  if (!words.length) return u.toString();
  const text =
    words.length <= 10
      ? encodeFragment(words.join(" "))
      : `${encodeFragment(words.slice(0, 5).join(" "))},${encodeFragment(words.slice(-5).join(" "))}`;
  u.hash = `:~:text=${text}`;
  return u.toString();
}

/**
 * Character ranges [start, end) of `text` covered by any of the quotes. Whitespace and
 * curly quotes are compared loosely; multi-paragraph quotes match paragraph by paragraph.
 */
export function highlightRanges(text: string, quotes: string[]): [number, number][] {
  // Normalised text plus a map from normalised index → original index.
  let flat = "";
  const map: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    let c = text[i]!;
    if (/\s/.test(c)) {
      if (space || !flat) continue;
      space = true;
      c = " ";
    } else {
      space = false;
      if (c === "‘" || c === "’") c = "'";
      else if (c === "“" || c === "”") c = '"';
    }
    flat += c;
    map.push(i);
  }
  const ranges: [number, number][] = [];
  for (const q of quotes) {
    for (const part of q.split(/\n+/)) {
      const needle = norm(part);
      if (needle.length < 12 && needle !== norm(text)) continue; // too short to be meaningful
      let from = 0;
      for (let hit = flat.indexOf(needle, from); hit >= 0; hit = flat.indexOf(needle, from)) {
        ranges.push([map[hit]!, map[hit + needle.length - 1]! + 1]);
        from = hit + needle.length;
      }
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}
