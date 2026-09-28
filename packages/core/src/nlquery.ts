/**
 * Natural-language search → Tymo query syntax, without AI:
 *   "articles about react from last week"   → type:article after:… before:… react
 *   "videos on youtube i haven't watched"   → type:video domain:youtube.com is:unread
 *   "red chair photos"                      → type:image red chair   (colour stays soft)
 *
 * Only kicks in for queries that read like a sentence and use no operators, so ordinary
 * keyword searches are never rewritten. Pure; `now` is injectable for tests.
 */
import type { SaveType } from "./schemas";

const DAY = 86_400_000;

const TYPE_WORDS: Record<string, SaveType> = {
  article: "article",
  articles: "article",
  "blog post": "article",
  "blog posts": "article",
  blogs: "article",
  essays: "article",
  video: "video",
  videos: "video",
  youtube: "video",
  repo: "repo",
  repos: "repo",
  repository: "repo",
  repositories: "repo",
  recipe: "recipe",
  recipes: "recipe",
  image: "image",
  images: "image",
  picture: "image",
  pictures: "image",
  photo: "image",
  photos: "image",
  screenshot: "screenshot",
  screenshots: "screenshot",
  pdf: "pdf",
  pdfs: "pdf",
  post: "social",
  posts: "social",
  tweet: "social",
  tweets: "social",
  book: "book",
  books: "book",
  movie: "movie",
  movies: "movie",
  film: "movie",
  films: "movie",
  note: "note",
  notes: "note",
  quote: "quote",
  quotes: "quote",
  highlight: "quote",
  highlights: "quote",
  product: "product",
  products: "product",
  "things to buy": "product",
  place: "place",
  places: "place",
  restaurant: "place",
  restaurants: "place",
  tool: "tool",
  tools: "tool",
  apps: "tool",
  snippet: "snippet",
  snippets: "snippet",
  document: "document",
  documents: "document",
  docs: "document",
};

const SITES: Record<string, string> = {
  github: "github.com",
  gitlab: "gitlab.com",
  youtube: "youtube.com",
  reddit: "reddit.com",
  twitter: "x.com",
  x: "x.com",
  "hacker news": "news.ycombinator.com",
  hn: "news.ycombinator.com",
  wikipedia: "wikipedia.org",
  medium: "medium.com",
  substack: "substack.com",
  instagram: "instagram.com",
  tiktok: "tiktok.com",
  linkedin: "linkedin.com",
  amazon: "amazon.",
  etsy: "etsy.com",
  vimeo: "vimeo.com",
  bluesky: "bsky.app",
  mastodon: "mastodon",
  "stack overflow": "stackoverflow.com",
  stackoverflow: "stackoverflow.com",
  arxiv: "arxiv.org",
  imdb: "imdb.com",
  goodreads: "goodreads.com",
};

const STOP = new Set(
  (
    "a an the i me my mine we our you your that this those these which what who whom " +
    "about around regarding on of in into for with from to by at as is are was were be been " +
    "saved save stored kept bookmarked found find show get give list all any some something " +
    "stuff things thing one ones there here it its and or please can could would should do did " +
    "have had has just only really very lot lots bunch"
  ).split(" "),
);

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const startOfDay = (t: number) => Math.floor(t / DAY) * DAY;

/** An inclusive [from, to] day range as after:/before: operators (both are exclusive). */
function range(from: number, to: number): string[] {
  return [`after:${iso(from - DAY)}`, `before:${iso(to + DAY)}`];
}

interface Rule {
  re: RegExp;
  apply: (m: RegExpMatchArray, now: number) => string[];
}

const NUM: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  few: 3,
  couple: 2,
};

const TIME_RULES: Rule[] = [
  {
    // "the last month" is a rolling window; "last month" (below) is the calendar month.
    re: /\b(?:in |over |during )?the (?:last|past) (week|month|year)\b/,
    apply: (m, n) =>
      range(
        startOfDay(n) - { week: 7, month: 30, year: 365 }[m[1] as "week"]! * DAY,
        startOfDay(n),
      ),
  },
  { re: /\btoday\b/, apply: (_, n) => range(startOfDay(n), startOfDay(n)) },
  { re: /\byesterday\b/, apply: (_, n) => range(startOfDay(n) - DAY, startOfDay(n) - DAY) },
  {
    re: /\b(this|last|past) (week|month|year)\b/,
    apply: (m, n) => {
      const today = startOfDay(n);
      const d = new Date(today);
      if (m[2] === "week") {
        const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
        const monday = today - dow * DAY;
        if (m[1] === "this") return range(monday, today);
        if (m[1] === "past") return range(today - 7 * DAY, today);
        return range(monday - 7 * DAY, monday - DAY);
      }
      if (m[2] === "month") {
        const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
        if (m[1] === "this") return range(first, today);
        if (m[1] === "past") return range(today - 30 * DAY, today);
        const prevFirst = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
        return range(prevFirst, first - DAY);
      }
      const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
      if (m[1] === "this") return range(jan1, today);
      if (m[1] === "past") return range(today - 365 * DAY, today);
      return range(Date.UTC(d.getUTCFullYear() - 1, 0, 1), jan1 - DAY);
    },
  },
  {
    re: /\b(?:(?:in )?the )?(?:last|past) (\d{1,3}|a|an|one|two|three|four|five|six|few|couple(?: of)?) (day|week|month|year)s?\b/,
    apply: (m, n) => {
      const k = /^\d/.test(m[1]!) ? +m[1]! : (NUM[m[1]!.replace(/ of$/, "")] ?? 1);
      const unit = { day: 1, week: 7, month: 30, year: 365 }[m[2] as "day"]!;
      return range(startOfDay(n) - k * unit * DAY, startOfDay(n));
    },
  },
  {
    re: /\b(\d{1,3}|a|an|one|two|three|four|five|six|few|couple(?: of)?) (day|week|month|year)s? ago\b/,
    apply: (m, n) => {
      const k = /^\d/.test(m[1]!) ? +m[1]! : (NUM[m[1]!.replace(/ of$/, "")] ?? 1);
      const unit = { day: 1, week: 7, month: 30, year: 365 }[m[2] as "day"]!;
      const center = startOfDay(n) - k * unit * DAY;
      const slack = Math.max(1, Math.round((unit * k) / 4)) * DAY;
      return range(center - slack, Math.min(center + slack, startOfDay(n)));
    },
  },
  {
    // "in march", "from may 2025", "march 2024" — a bare "may" is just a word.
    re: new RegExp(
      `\\b(?:(?:in|from|during|since) (${MONTHS.join("|")})(?: (\\d{4}))?|(${MONTHS.join("|")}) (\\d{4}))\\b`,
    ),
    apply: (m, n) => {
      const month = MONTHS.indexOf((m[1] ?? m[3])!);
      const yearText = m[2] ?? m[4];
      const now = new Date(n);
      let year = yearText ? +yearText : now.getUTCFullYear();
      if (!yearText && month > now.getUTCMonth()) year--; // "in march" = the most recent March
      return range(Date.UTC(year, month, 1), Date.UTC(year, month + 1, 1) - DAY);
    },
  },
  {
    re: /\b(?:in|from|during) (19\d\d|20\d\d)\b/,
    apply: (m) => range(Date.UTC(+m[1]!, 0, 1), Date.UTC(+m[1]! + 1, 0, 1) - DAY),
  },
];

const FLAG_RULES: Rule[] = [
  { re: /\b(my )?(favou?rites?|starred|faves)\b/, apply: () => ["is:fav"] },
  {
    re: /\b(unread|unopened|never (?:opened|read|watched)|(?:i )?(?:haven't|have not|didn't|did not) (?:read|opened?|watched?|looked at)(?: yet)?)\b/,
    apply: () => ["is:unread"],
  },
  { re: /\bin (?:my |the )?inbox\b/, apply: () => ["in:inbox"] },
  { re: /\b(?:archived|in (?:my |the )archive)\b/, apply: () => ["in:archive"] },
  { re: /\bsnoozed\b/, apply: () => ["is:snoozed"] },
  { re: /\b(broken|dead) links?\b/, apply: () => ["is:broken"] },
  { re: /\btagged (?:with |as )?#?([\w-]{1,40})\b/, apply: (m) => [`tag:${m[1]}`] },
];

function siteRule(): Rule {
  const names = Object.keys(SITES)
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/ /g, "\\s"));
  return {
    re: new RegExp(`\\b(?:from|on|via|at) (${names.join("|")}|[a-z0-9-]+(?:\\.[a-z0-9-]+)+)\\b`),
    apply: (m) => {
      const key = m[1]!.replace(/\s+/g, " ");
      return [`domain:${SITES[key] ?? key}`];
    },
  };
}
const SITE_RULE = siteRule();

/**
 * Light plural trimming. Search terms are prefix-matched, so "teams" → "team" still finds
 * "teams", and "stories" → "stor" finds "story" and "stories".
 */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3);
  if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export interface Interpretation {
  /** Query in Tymo syntax. */
  query: string;
  /** False when the input was left as is (keyword search or explicit operators). */
  changed: boolean;
}

/** Whether input reads like a sentence rather than keywords or operator syntax. */
export function looksNatural(input: string): boolean {
  const s = input.trim().toLowerCase();
  if (!s || /(^|\s)-?\w+:\S|(^|\s)#\w|"/.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length === 1) return Object.hasOwn(TYPE_WORDS, s) && s.endsWith("s");
  return (
    words.length >= 3 ||
    [...TIME_RULES, ...FLAG_RULES, SITE_RULE].some((r) => r.re.test(s)) ||
    words.some((w) => Object.hasOwn(TYPE_WORDS, w) && w.endsWith("s"))
  );
}

export function interpretQuery(input: string, now = Date.now()): Interpretation {
  const original = input.trim().replace(/\s+/g, " ");
  if (!looksNatural(original)) return { query: original, changed: false };

  let s = ` ${original
    .toLowerCase()
    .replace(/[?!.,;]+(?=\s|$)/g, " ")
    .replace(/’/g, "'")} `;
  const ops: string[] = [];
  const take = (rules: Rule[], once = true) => {
    for (const r of rules) {
      const g = new RegExp(r.re.source, "g");
      let hit = false;
      s = s.replace(g, (...args) => {
        if (once && hit) return " ";
        hit = true;
        const m = args.slice(0, -2) as unknown as RegExpMatchArray;
        ops.push(...r.apply(m, now));
        return " ";
      });
      if (hit && once && rules === TIME_RULES) return; // one time range is enough
    }
  };
  take(TIME_RULES);
  take(FLAG_RULES);
  take([SITE_RULE]);

  // Type words (multi-word phrases first). Singular words only count as types when they are
  // plainly used as one ("a video about…"), so "tool" in "tool for diffing" stays a keyword.
  const types = new Set<SaveType>();
  for (const phrase of Object.keys(TYPE_WORDS).filter((k) => k.includes(" "))) {
    if (s.includes(` ${phrase} `)) {
      types.add(TYPE_WORDS[phrase]!);
      s = s.replace(` ${phrase} `, " ");
    }
  }
  const words = s.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  words.forEach((w, i) => {
    const t = TYPE_WORDS[w];
    const prev = words[i - 1];
    if (
      t &&
      (w.endsWith("s") ||
        w === "youtube" ||
        ["a", "an", "the", "that", "this", "some"].includes(prev ?? ""))
    ) {
      types.add(t);
      return;
    }
    if (!STOP.has(w) && !/^'?s$/.test(w)) kept.push(stem(w.replace(/^'+|'+$/g, "")));
  });
  for (const t of types) ops.push(`type:${t}`);

  const query = [...ops, ...kept.filter(Boolean)].join(" ").trim();
  if (!query || query === original.toLowerCase()) return { query: original, changed: false };
  return { query, changed: true };
}
