import { describe, expect, it } from "vitest";
import { durationMinutes, extractFacts, formatPrice, sanitizeFacts } from "./facts";
import { parseHtmlMetadata } from "./html-metadata";
import { detectType } from "./detect";

const meta = (o: Record<string, string> = {}) => new Map(Object.entries(o));

describe("extractFacts", () => {
  it("reads recipes (time, ingredients, servings, rating) through @graph", () => {
    const ld = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", name: "x" },
        {
          "@type": ["Recipe"],
          prepTime: "PT15M",
          cookTime: "PT1H",
          recipeIngredient: ["a", "b", "c"],
          recipeYield: ["4 servings", "4"],
          aggregateRating: { ratingValue: "4.6", ratingCount: "213" },
        },
      ],
    };
    expect(extractFacts([ld], meta())).toEqual({
      kind: "recipe",
      minutes: 75,
      ingredients: 3,
      servings: "4 servings",
      rating: 4.6,
      ratingCount: 213,
    });
  });

  it("reads products with offers and brand, normalising ratings out of 10", () => {
    const ld = {
      "@type": "Product",
      brand: { "@type": "Brand", name: "Hay" },
      offers: [
        { price: "1,299.00", priceCurrency: "usd", availability: "https://schema.org/InStock" },
      ],
      aggregateRating: { ratingValue: 8, bestRating: 10 },
    };
    expect(extractFacts([ld], meta())).toEqual({
      kind: "product",
      brand: "Hay",
      price: 1299,
      currency: "USD",
      inStock: true,
      rating: 4,
    });
  });

  it("reads books and films", () => {
    expect(
      extractFacts(
        [{ "@type": "Book", author: [{ name: "Ursula K. Le Guin" }], datePublished: "1969-03" }],
        meta(),
      ),
    ).toEqual({ kind: "book", author: "Ursula K. Le Guin", year: 1969 });
    expect(
      extractFacts(
        [
          {
            "@type": "Movie",
            datePublished: "1999-03-31",
            director: { name: "Lana Wachowski" },
            genre: ["Action", "Sci-Fi", "Other"],
            duration: "PT2H16M",
          },
        ],
        meta(),
      ),
    ).toEqual({
      kind: "movie",
      year: 1999,
      director: "Lana Wachowski",
      genre: "Action, Sci-Fi",
      minutes: 136,
    });
  });

  it("falls back to Open Graph product and book tags", () => {
    expect(
      extractFacts([], meta({ "product:price:amount": "24.9", "product:price:currency": "EUR" })),
    ).toEqual({ kind: "product", price: 24.9, currency: "EUR" });
    expect(extractFacts([], meta({ "book:author": "Jane Doe" }))).toEqual({
      kind: "book",
      author: "Jane Doe",
    });
    expect(extractFacts([], meta({ "book:author": "https://example.com/jane" }))).toBeUndefined();
  });

  it("rejects nonsense values", () => {
    const f = extractFacts(
      [
        {
          "@type": "Product",
          offers: { price: "free", priceCurrency: "<script>" },
          aggregateRating: { ratingValue: 99, bestRating: 5 },
        },
      ],
      meta(),
    );
    expect(f).toEqual({ kind: "product" });
    expect(extractFacts([{ "@type": "Article" }, "junk", null], meta())).toBeUndefined();
  });
});

describe("helpers", () => {
  it("parses ISO durations", () => {
    expect(durationMinutes("PT45M")).toBe(45);
    expect(durationMinutes("PT1H30M")).toBe(90);
    expect(durationMinutes("P1DT2H")).toBe(1560);
    expect(durationMinutes("45 minutes")).toBeUndefined();
    expect(durationMinutes("PT0M")).toBeUndefined();
  });

  it("formats prices", () => {
    expect(formatPrice(24.9, "EUR", "en-US")).toBe("€24.90");
    expect(formatPrice(1299, "USD", "en-US")).toBe("$1,299");
    expect(formatPrice(5, "ZZZ", "en-US")).toMatch(/5/);
    expect(formatPrice(5, undefined, "en-US")).toBe("5");
  });
});

describe("page parsing", () => {
  it("attaches facts and detects products", () => {
    const html = `<html><head><meta property="og:type" content="product">
      <script type="application/ld+json">{"@type":"Product","name":"Chair","offers":{"price":"249","priceCurrency":"EUR"}}</script>
      </head><body></body></html>`;
    const m = parseHtmlMetadata(html, "https://shop.example.com/chair");
    expect(m.facts).toEqual({ kind: "product", price: 249, currency: "EUR" });
    expect(detectType("https://shop.example.com/chair", { jsonLdTypes: m.jsonLdTypes })).toBe(
      "product",
    );
    expect(detectType("https://shop.example.com/x", { ogType: "product" })).toBe("product");
  });
});

describe("sanitizeFacts", () => {
  it("keeps well-typed fields and drops everything else", () => {
    expect(
      sanitizeFacts({
        kind: "product",
        price: "free",
        currency: "<b>",
        rating: 99,
        brand: "Hay",
        inStock: "yes",
        extra: { evil: true },
      }),
    ).toEqual({ kind: "product", brand: "Hay" });
    expect(sanitizeFacts({ kind: "recipe", minutes: 35, rating: 4.5 })).toEqual({
      kind: "recipe",
      minutes: 35,
      rating: 4.5,
    });
    expect(sanitizeFacts({ kind: "script" })).toBeNull();
    expect(sanitizeFacts("x")).toBeNull();
    expect(sanitizeFacts(null)).toBeNull();
  });
});
