/**
 * Structured details for rich cards, read from schema.org JSON-LD and Open Graph tags:
 * cooking time and ingredients for recipes, price for products, year/author/director for
 * books and films, address for places, and ratings. Pure and defensive: pages lie, so every
 * value is type-checked, range-checked and length-capped.
 */

export interface Facts {
  kind: "recipe" | "product" | "book" | "movie" | "place";
  /** Normalised to 0–5. */
  rating?: number;
  ratingCount?: number;
  minutes?: number;
  ingredients?: number;
  servings?: string;
  price?: number;
  currency?: string;
  brand?: string;
  inStock?: boolean;
  author?: string;
  year?: number;
  director?: string;
  genre?: string;
  address?: string;
}

type Node = Record<string, unknown>;

const KINDS: [Facts["kind"], string[]][] = [
  ["recipe", ["recipe"]],
  ["product", ["product", "productgroup", "individualproduct"]],
  ["book", ["book"]],
  ["movie", ["movie", "tvseries", "tvseason", "tvepisode"]],
  [
    "place",
    [
      "restaurant",
      "localbusiness",
      "touristattraction",
      "hotel",
      "place",
      "cafeorcoffeeshop",
      "bar",
    ],
  ],
];

function types(n: Node): string[] {
  const t = n["@type"];
  return (Array.isArray(t) ? t : [t])
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.toLowerCase());
}

/** Flattens JSON-LD (arrays, @graph, mainEntity) into a bounded list of objects. */
export function flattenLd(data: unknown, out: Node[] = [], depth = 0): Node[] {
  if (depth > 5 || out.length >= 100 || !data || typeof data !== "object") return out;
  if (Array.isArray(data)) {
    for (const d of data.slice(0, 50)) flattenLd(d, out, depth + 1);
    return out;
  }
  const n = data as Node;
  out.push(n);
  if (n["@graph"]) flattenLd(n["@graph"], out, depth + 1);
  if (n.mainEntity && typeof n.mainEntity === "object") flattenLd(n.mainEntity, out, depth + 1);
  return out;
}

const str = (v: unknown, max = 120): string | undefined => {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
};

const num = (v: unknown): number | undefined => {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? parseFloat(v.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** A person/organisation value → its name ("Jane", {name:"Jane"}, [{name:"Jane"}, …]). */
function name(v: unknown): string | undefined {
  if (Array.isArray(v)) {
    const names = v.slice(0, 3).map(name).filter(Boolean);
    return names.length ? names.join(", ").slice(0, 120) : undefined;
  }
  if (v && typeof v === "object") return str((v as Node).name);
  return str(v);
}

/** ISO 8601 duration (PT1H30M, P0DT45M) → minutes. */
export function durationMinutes(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const m =
    /^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:\d+(?:\.\d+)?S)?)?$/i.exec(
      v.trim(),
    );
  if (!m) return undefined;
  const mins = +(m[1] ?? 0) * 1440 + +(m[2] ?? 0) * 60 + +(m[3] ?? 0);
  return mins > 0 && mins < 60 * 24 * 14 ? Math.round(mins) : undefined;
}

function year(v: unknown): number | undefined {
  const m = /\b(1[5-9]\d\d|20\d\d|21\d\d)\b/.exec(typeof v === "string" ? v : String(v ?? ""));
  return m ? +m[1]! : undefined;
}

function rating(n: Node): Pick<Facts, "rating" | "ratingCount"> {
  const r = n.aggregateRating as Node | undefined;
  if (!r || typeof r !== "object") return {};
  const value = num(r.ratingValue);
  const best = num(r.bestRating) ?? 5;
  if (value === undefined || best <= 0 || value < 0 || value > best) return {};
  const count = num(r.ratingCount) ?? num(r.reviewCount);
  return {
    rating: Math.round((value / best) * 5 * 10) / 10,
    ...(count !== undefined && count > 0 ? { ratingCount: Math.round(count) } : {}),
  };
}

function offer(n: Node): Pick<Facts, "price" | "currency" | "inStock"> {
  const raw = Array.isArray(n.offers) ? n.offers[0] : n.offers;
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Node;
  const price = num(o.price) ?? num(o.lowPrice);
  const currency = str(o.priceCurrency, 8)?.toUpperCase();
  const avail = str(o.availability)?.toLowerCase();
  return {
    ...(price !== undefined && price >= 0 && price < 1e9 ? { price } : {}),
    ...(currency && /^[A-Z]{3}$/.test(currency) ? { currency } : {}),
    ...(avail ? { inStock: /instock|limitedavailability|presale|preorder/.test(avail) } : {}),
  };
}

function address(v: unknown): string | undefined {
  if (typeof v === "string") return str(v, 200);
  if (!v || typeof v !== "object") return undefined;
  const a = v as Node;
  return str(
    [a.streetAddress, a.addressLocality, a.addressCountry && name(a.addressCountry)]
      .map((x) => str(x))
      .filter(Boolean)
      .join(", "),
    200,
  );
}

function clean(f: Facts): Facts {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Facts;
}

/**
 * Facts for the first recognised schema.org entity, falling back to Open Graph
 * product/book tags (`meta` holds lower-cased property/name → content).
 */
export function extractFacts(ld: unknown[], meta: Map<string, string>): Facts | undefined {
  const nodes = ld.flatMap((d) => flattenLd(d));
  for (const [kind, names] of KINDS) {
    const n = nodes.find((x) => types(x).some((t) => names.includes(t)));
    if (!n) continue;
    const base = { kind, ...rating(n) } as Facts;
    switch (kind) {
      case "recipe": {
        const ing = Array.isArray(n.recipeIngredient)
          ? n.recipeIngredient
          : Array.isArray(n.ingredients)
            ? n.ingredients
            : [];
        const minutes =
          durationMinutes(n.totalTime) ??
          (() => {
            const p = durationMinutes(n.prepTime) ?? 0;
            const c = durationMinutes(n.cookTime) ?? 0;
            return p + c > 0 ? p + c : undefined;
          })();
        const y = Array.isArray(n.recipeYield) ? n.recipeYield[0] : n.recipeYield;
        return clean({
          ...base,
          minutes,
          ingredients: ing.length ? Math.min(ing.length, 999) : undefined,
          servings: str(y, 40),
        });
      }
      case "product":
        return clean({ ...base, ...offer(n), brand: name(n.brand) });
      case "book":
        return clean({
          ...base,
          author: name(n.author),
          year: year(n.datePublished ?? n.copyrightYear),
        });
      case "movie":
        return clean({
          ...base,
          year: year(n.datePublished ?? n.dateCreated ?? n.startDate),
          director: name(n.director),
          genre: Array.isArray(n.genre) ? str(n.genre.slice(0, 2).join(", ")) : str(n.genre),
          minutes: durationMinutes(n.duration),
        });
      case "place":
        return clean({ ...base, address: address(n.address) });
    }
  }
  const price = num(meta.get("product:price:amount") ?? meta.get("og:price:amount"));
  if (price !== undefined) {
    const currency = str(
      meta.get("product:price:currency") ?? meta.get("og:price:currency"),
      8,
    )?.toUpperCase();
    return clean({
      kind: "product",
      price,
      currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined,
      brand: str(meta.get("product:brand")),
    });
  }
  const author = str(meta.get("book:author") ?? meta.get("books:author"));
  if (author && !/^https?:/.test(author)) {
    return clean({ kind: "book", author, year: year(meta.get("book:release_date")) });
  }
  return undefined;
}

/** Short money string for cards: "€24.90", "$1,299", "2 400 SEK". */
export function formatPrice(price: number, currency?: string, locale?: string): string {
  try {
    if (currency)
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: price % 1 ? 2 : 0,
      }).format(price);
  } catch {
    /* unknown currency code */
  }
  return `${price.toLocaleString(locale)}${currency ? ` ${currency}` : ""}`;
}

const FACT_KINDS = new Set<Facts["kind"]>(["recipe", "product", "book", "movie", "place"]);

/**
 * Facts read back from storage. Metadata can also be written through the API, so every
 * field is type-checked again before the UI formats it.
 */
export function sanitizeFacts(v: unknown): Facts | null {
  if (!v || typeof v !== "object") return null;
  const f = v as Record<string, unknown>;
  if (!FACT_KINDS.has(f.kind as Facts["kind"])) return null;
  const n = (x: unknown, max: number) =>
    typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max ? x : undefined;
  const t = (x: unknown, max = 120) =>
    typeof x === "string" && x.trim() ? x.slice(0, max) : undefined;
  const currency = t(f.currency, 3);
  return clean({
    kind: f.kind as Facts["kind"],
    rating: n(f.rating, 5),
    ratingCount: n(f.ratingCount, 1e9),
    minutes: n(f.minutes, 60 * 24 * 14),
    ingredients: n(f.ingredients, 999),
    servings: t(f.servings, 40),
    price: n(f.price, 1e9),
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined,
    brand: t(f.brand),
    inStock: typeof f.inStock === "boolean" ? f.inStock : undefined,
    author: t(f.author),
    year: n(f.year, 2200),
    director: t(f.director),
    genre: t(f.genre),
    address: t(f.address, 200),
  });
}
