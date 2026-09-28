import { z } from "zod";
import { isHttpUrl } from "./url";

export const SAVE_TYPES = [
  "link",
  "article",
  "repo",
  "video",
  "social",
  "image",
  "screenshot",
  "pdf",
  "document",
  "tool",
  "place",
  "recipe",
  "book",
  "movie",
  "note",
  "snippet",
  "product",
  "quote",
] as const;
export type SaveType = (typeof SAVE_TYPES)[number];

export const SAVE_TYPE_LABELS: Record<SaveType, string> = {
  link: "Link",
  article: "Article",
  repo: "Repository",
  video: "Video",
  social: "Post",
  image: "Image",
  screenshot: "Screenshot",
  pdf: "PDF",
  document: "Document",
  tool: "Tool",
  place: "Place",
  recipe: "Recipe",
  book: "Book",
  movie: "Movie",
  note: "Note",
  snippet: "Snippet",
  product: "Product",
  quote: "Quote",
};

export const CAPTURE_METHODS = [
  "web",
  "extension",
  "extension-session",
  "extension-context-menu",
  "extension-screenshot",
  "upload",
  "import",
  "api",
] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

export const SAVE_STATUSES = ["inbox", "active"] as const;
export type SaveStatus = (typeof SAVE_STATUSES)[number];

const MAX_URL = 4096;

export const httpUrl = z
  .string()
  .trim()
  .max(MAX_URL)
  .refine(isHttpUrl, { message: "Must be an http(s) URL" });

/** Tag names are lowercase slugs: letters, digits, dash, underscore, slash, dot. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_/.+]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 48);
}

export const tagList = z
  .array(z.string().max(64))
  .max(50)
  .transform((tags) => [...new Set(tags.map(normalizeTag).filter(Boolean))]);

export const createSaveInput = z
  .object({
    url: httpUrl.optional(),
    type: z.enum(SAVE_TYPES).optional(),
    title: z.string().trim().max(500).optional(),
    description: z.string().trim().max(5000).optional(),
    notes: z.string().max(50_000).optional(),
    body: z.string().max(200_000).optional(),
    faviconUrl: httpUrl.optional(),
    imageUrl: httpUrl.optional(),
    source: z.string().max(MAX_URL).optional(),
    tags: tagList.optional(),
    collectionIds: z.array(z.string().max(64)).max(50).optional(),
    captureMethod: z.enum(CAPTURE_METHODS).optional(),
    favorite: z.boolean().optional(),
    bookmark: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => v.url || v.body?.trim() || v.title?.trim(), {
    message: "A save needs a URL, a title or some text",
  });
export type CreateSaveInput = z.infer<typeof createSaveInput>;

export const updateSaveInput = z.object({
  title: z.string().trim().max(500).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  notes: z.string().max(50_000).nullable().optional(),
  body: z.string().max(200_000).nullable().optional(),
  type: z.enum(SAVE_TYPES).optional(),
  url: httpUrl.nullable().optional(),
  tags: tagList.optional(),
  collectionIds: z.array(z.string().max(64)).max(50).optional(),
  favorite: z.boolean().optional(),
  bookmark: z.boolean().optional(),
  archived: z.boolean().optional(),
  status: z.enum(SAVE_STATUSES).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateSaveInput = z.infer<typeof updateSaveInput>;

export const collectionInput = z.object({
  name: z.string().trim().min(1).max(80),
  icon: z.string().trim().max(32).optional(),
  description: z.string().trim().max(1000).optional(),
  parentId: z.string().max(64).nullable().optional(),
});
export type CollectionInput = z.infer<typeof collectionInput>;

export const sessionTabInput = z.object({
  url: z.string().max(MAX_URL),
  title: z.string().max(500).optional(),
  faviconUrl: z.string().max(MAX_URL).optional(),
  windowIndex: z.number().int().min(0).max(1000).default(0),
  index: z.number().int().min(0).max(10_000).optional(),
  pinned: z.boolean().optional(),
  groupTitle: z.string().max(200).optional(),
  groupColor: z.string().max(20).optional(),
});

export const createSessionInput = z.object({
  name: z.string().trim().max(200).optional(),
  notes: z.string().max(10_000).optional(),
  browser: z.string().max(40).optional(),
  tags: tagList.optional(),
  tabs: z.array(sessionTabInput).min(1).max(1000),
});
export type CreateSessionInput = z.infer<typeof createSessionInput>;

/* ---------- Type-specific metadata (validated when present, never required) ---------- */

export const placeMetadata = z.object({
  address: z.string().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  website: httpUrl.optional(),
});
export const bookMetadata = z.object({
  author: z.string().max(300).optional(),
  isbn: z.string().max(20).optional(),
  coverUrl: httpUrl.optional(),
});
export const movieMetadata = z.object({
  year: z.number().int().min(1870).max(2200).optional(),
  rating: z.number().min(0).max(10).optional(),
  posterUrl: httpUrl.optional(),
});
export const recipeMetadata = z.object({
  ingredients: z.array(z.string().max(300)).max(200).optional(),
  instructions: z.string().max(20_000).optional(),
});
export const toolMetadata = z.object({
  category: z.string().max(100).optional(),
  pricing: z.string().max(100).optional(),
});
export const repoMetadata = z.object({
  owner: z.string().max(100).optional(),
  repo: z.string().max(100).optional(),
});

export const TYPE_METADATA_SCHEMAS: Partial<Record<SaveType, z.ZodType>> = {
  place: placeMetadata,
  book: bookMetadata,
  movie: movieMetadata,
  recipe: recipeMetadata,
  tool: toolMetadata,
  repo: repoMetadata,
};
