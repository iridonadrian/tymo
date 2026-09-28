import type { ReaderContent } from "@tymo/core/reader";
import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch('subsec') * 1000)`;

export const saves = sqliteTable(
  "saves",
  {
    id: text("id").primaryKey(),
    /** Stable integer key; used as the FTS5 rowid (implicit rowids may change on VACUUM). */
    seq: integer("seq").notNull(),
    type: text("type").notNull().default("link"),
    status: text("status", { enum: ["inbox", "active"] })
      .notNull()
      .default("inbox"),
    url: text("url"),
    normalizedUrl: text("normalized_url"),
    title: text("title").notNull(),
    description: text("description"),
    domain: text("domain"),
    faviconUrl: text("favicon_url"),
    imageUrl: text("image_url"),
    notes: text("notes"),
    body: text("body"),
    extractedText: text("extracted_text"),
    /** Reader view: the article as structured blocks (see @tymo/core/reader). */
    reader: text("reader", { mode: "json" }).$type<ReaderContent>(),
    aiSummary: text("ai_summary"),
    isFavorite: integer("is_favorite", { mode: "boolean" }).notNull().default(false),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    /** On the Bookmarks page: sites to come back to, rather than things to read. */
    isBookmark: integer("is_bookmark", { mode: "boolean" }).notNull().default(false),
    captureMethod: text("capture_method").notNull().default("web"),
    source: text("source"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    metadataStatus: text("metadata_status", { enum: ["none", "pending", "done", "failed"] })
      .notNull()
      .default("none"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
    lastOpenedAt: integer("last_opened_at"),
    openCount: integer("open_count").notNull().default(0),
    /** Hidden from the inbox until this time (ms), then it comes back. */
    snoozedUntil: integer("snoozed_until"),
  },
  (t) => [
    uniqueIndex("saves_seq_idx").on(t.seq),
    index("saves_created_idx").on(t.createdAt),
    index("saves_status_idx").on(t.status, t.isArchived, t.createdAt),
    index("saves_fav_idx").on(t.isFavorite, t.createdAt),
    index("saves_domain_idx").on(t.domain),
    index("saves_type_idx").on(t.type),
    index("saves_norm_url_idx").on(t.normalizedUrl),
    index("saves_opened_idx").on(t.lastOpenedAt),
    index("saves_snoozed_idx").on(t.snoozedUntil),
  ],
);

export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    icon: text("icon"),
    description: text("description"),
    coverUrl: text("cover_url"),
    parentId: text("parent_id"),
    smartRules: text("smart_rules", { mode: "json" }).$type<unknown>(),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [index("collections_parent_idx").on(t.parentId)],
);

export const saveCollections = sqliteTable(
  "save_collections",
  {
    saveId: text("save_id")
      .notNull()
      .references(() => saves.id, { onDelete: "cascade" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    addedAt: integer("added_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.saveId, t.collectionId] }),
    index("save_collections_col_idx").on(t.collectionId),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("tags_name_idx").on(t.name)],
);

export const saveTags = sqliteTable(
  "save_tags",
  {
    saveId: text("save_id")
      .notNull()
      .references(() => saves.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.saveId, t.tagId] }), index("save_tags_tag_idx").on(t.tagId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    notes: text("notes"),
    browser: text("browser"),
    tabCount: integer("tab_count").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
    lastRestoredAt: integer("last_restored_at"),
  },
  (t) => [index("sessions_created_idx").on(t.createdAt)],
);

export const sessionItems = sqliteTable(
  "session_items",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    saveId: text("save_id").references(() => saves.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    windowIndex: integer("window_index").notNull().default(0),
    url: text("url").notNull(),
    title: text("title").notNull(),
    faviconUrl: text("favicon_url"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    groupTitle: text("group_title"),
    groupColor: text("group_color"),
  },
  (t) => [
    index("session_items_session_idx").on(t.sessionId, t.position),
    index("session_items_save_idx").on(t.saveId),
  ],
);

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    saveId: text("save_id").references(() => saves.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["upload", "screenshot", "snapshot"] }).notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("files_save_idx").on(t.saveId)],
);

/** One embedding per save for semantic search / related items / near-duplicate detection. */
export const embeddings = sqliteTable(
  "embeddings",
  {
    saveId: text("save_id")
      .primaryKey()
      .references(() => saves.id, { onDelete: "cascade" }),
    /** `${provider}:${model}` — vectors from different models are never compared. */
    model: text("model").notNull(),
    dims: integer("dims").notNull(),
    /** Little-endian Float32Array, L2-normalized. */
    vector: blob("vector", { mode: "buffer" }).notNull(),
    /** sha256 of model + embedded text; unchanged content is never re-embedded. */
    contentHash: text("content_hash").notNull(),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [index("embeddings_model_idx").on(t.model)],
);

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  createdAt: integer("created_at").notNull().default(now),
  lastUsedAt: integer("last_used_at"),
});

/** OAuth clients registered dynamically (RFC 7591) — e.g. claude.ai's connector. Public clients: no secret. */
export const oauthClients = sqliteTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris", { mode: "json" }).notNull().$type<string[]>(),
  createdAt: integer("created_at").notNull().default(now),
});

/** One-time authorization codes (hashed), bound to client, redirect URI, PKCE challenge and resource. */
export const oauthCodes = sqliteTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: text("scope").notNull(),
  resource: text("resource").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  /** Grant created from this code, revoked if the code is ever replayed. */
  grantId: text("grant_id"),
});

/** One row per authorization (a "connected app"). Tokens are stored as SHA-256 hashes only. */
export const oauthGrants = sqliteTable(
  "oauth_grants",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    resource: text("resource").notNull(),
    accessHash: text("access_hash").notNull().unique(),
    accessExpiresAt: integer("access_expires_at").notNull(),
    refreshHash: text("refresh_hash").notNull().unique(),
    refreshExpiresAt: integer("refresh_expires_at").notNull(),
    createdAt: integer("created_at").notNull().default(now),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [index("oauth_grants_client_idx").on(t.clientId)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>(),
  updatedAt: integer("updated_at").notNull().default(now),
});

export type SaveRow = typeof saves.$inferSelect;
export type CollectionRow = typeof collections.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
