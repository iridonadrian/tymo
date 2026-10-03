"use server";
/**
 * Server Actions used by the web UI. Next.js only accepts them from the same origin
 * (CSRF protection); every input is validated here because actions are public endpoints.
 */
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  collectionInput,
  createSaveInput,
  smartRules,
  updateSaveInput,
  detectType,
  titleFromUrl,
  cleanTitle,
  parsePastedLinks,
} from "@tymo/core";
import { parseHtmlMetadata } from "@tymo/core/html-metadata";
import * as saves from "./saves";
import * as cols from "./collections";
import * as sess from "./sessions";
import * as tagsRepo from "./tags";
import * as tokens from "./tokens";
import * as oauth from "./oauth";
import { enqueueEnrichment, enrichSave } from "./enrich";
import { safeFetch } from "./fetcher";
import { storeFile, MAX_UPLOAD_BYTES } from "./files";
import { importAuto, MAX_IMPORT_BYTES } from "./importer";
import { aiSettingsSchema, clearAiKey, getAiSettings, saveAiSettings } from "./settings";
import { interpretWithAi, suggestForSave, testAiConnection } from "./ai";
import { dismissDuplicate } from "./duplicates";
import { enqueueOcr, ocrSave } from "./ocr";
import { checkLink, checkLinksBatch, saveLinkCheckSettings } from "./linkcheck";
import { backupSettingsSchema, saveBackupSettings, writeBackupFile } from "./backup";
import { changePassphrase, disableSync, enableSync, syncNow } from "./sync";
import { archiveSave, archiveSettingsSchema, saveArchiveSettings } from "./archive";
import { flushEmbeddings, pruneStaleEmbeddings, queueMissingEmbeddings } from "./embeddings";
import { getDb, schema } from "./db";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE, SESSION_TTL_MS, checkPassword, issueSessionCookie } from "./auth";
import { rateLimit } from "./rate-limit";
import { clientIp, publicErrorMessage } from "./privacy";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const id = z.string().min(1).max(64);
const ids = z.array(id).min(1).max(5000);

function refresh() {
  revalidatePath("/", "layout");
}

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof z.ZodError)
      return { ok: false, error: err.issues[0]?.message ?? "Invalid input" };
    return { ok: false, error: publicErrorMessage(err) };
  }
}

/* ------------------------------------------------------------------ saves */

export async function createSaveAction(input: unknown) {
  return run(async () => {
    const data = createSaveInput.parse(input);
    const r = await saves.createSave(data, { captureMethod: "web" });
    if (r.needsEnrichment) enqueueEnrichment([r.id]);
    refresh();
    return r;
  });
}

const colorItems = z
  .array(
    z.object({
      id,
      colors: z
        .array(
          z.object({
            hex: z.string().regex(/^#[0-9a-f]{6}$/),
            share: z.number().min(0).max(1),
          }),
        )
        .max(8),
    }),
  )
  .min(1)
  .max(100);

/** Colours measured in the browser from already-proxied images (see components/save-card). */
export async function setColorsAction(items: unknown) {
  return run(async () => saves.setSaveColors(colorItems.parse(items)));
}

export async function previewUrlAction(url: unknown) {
  return run(async () => {
    const u = z.string().url().max(4096).parse(url);
    const existing = await saves.findByUrl(await getDb(), u);
    try {
      const res = await safeFetch(u);
      const m = res.html ? parseHtmlMetadata(res.html, res.finalUrl) : null;
      return {
        title: m?.title ? cleanTitle(m.title, res.finalUrl) : titleFromUrl(u),
        description: m?.description ?? null,
        imageUrl: m?.imageUrl ?? null,
        faviconUrl: m?.faviconUrl ?? null,
        type: detectType(res.finalUrl, {
          ogType: m?.ogType,
          jsonLdTypes: m?.jsonLdTypes,
          contentType: res.contentType,
        }),
        existingId: existing?.id ?? null,
      };
    } catch {
      return {
        title: titleFromUrl(u),
        description: null,
        imageUrl: null,
        faviconUrl: null,
        type: detectType(u),
        existingId: existing?.id ?? null,
      };
    }
  });
}

export async function updateSaveAction(saveId: unknown, input: unknown) {
  return run(async () => {
    await saves.updateSave(id.parse(saveId), updateSaveInput.parse(input));
    refresh();
  });
}

const bulkSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum([
      "archive",
      "unarchive",
      "favorite",
      "unfavorite",
      "bookmark",
      "unbookmark",
      "done",
      "inbox",
      "delete",
    ]),
  }),
  z.object({ kind: z.enum(["addTag", "removeTag"]), tag: z.string().min(1).max(64) }),
  z.object({ kind: z.enum(["addToCollection", "removeFromCollection"]), collectionId: id }),
  z.object({
    kind: z.literal("snooze"),
    until: z
      .number()
      .int()
      .min(0)
      .max(Date.UTC(2200, 0, 1))
      .nullable(),
  }),
]);

export async function bulkAction(saveIds: unknown, action: unknown) {
  return run(async () => {
    await saves.bulkUpdate(ids.parse(saveIds), bulkSchema.parse(action));
    refresh();
  });
}

export async function interpretQueryAction(q: unknown) {
  return run(async () => {
    const text = z.string().min(1).max(300).parse(q);
    const ip = clientIp(await headers());
    if (!rateLimit(`ai-query:${ip}`, 20)) throw new Error("Too many requests, try again soon");
    const query = await interpretWithAi(text);
    if (!query) throw new Error("The AI didn't return a query");
    return query;
  });
}

export async function saveHighlightAction(saveId: unknown, text: unknown) {
  return run(async () => {
    const r = await saves.saveHighlight(
      id.parse(saveId),
      z.string().min(1).max(20_000).parse(text),
    );
    refresh();
    return r;
  });
}

/* ------------------------------------------------------------ connectors */

/**
 * The owner's answer on the OAuth consent page. Returns the URL to send the browser to
 * (the app's redirect URI with a code, or with access_denied).
 */
export async function authorizeAction(params: unknown, approve: unknown, allowWrite: unknown) {
  return run(async () => {
    const origin = oauth.publicOrigin(await headers());
    const req = await oauth.checkAuthorizeRequest(
      z.record(z.string(), z.string()).parse(params),
      origin,
    );
    return oauth.decideAuthorization(
      req,
      origin,
      z.boolean().parse(approve),
      z.boolean().parse(allowWrite),
    );
  });
}

export async function disconnectAppAction(grantId: unknown) {
  return run(async () => {
    await oauth.disconnectApp(id.parse(grantId));
    refresh();
  });
}

/* ------------------------------------------------------------- bookmarks */

const pastedLinks = z.object({
  text: z.string().min(1).max(1_000_000),
  collectionId: id.optional(),
  newFolder: z.string().trim().max(80).optional(),
});

/** "Paste links": URLs from Safari's Copy Links, a tab list or any text → bookmarks. */
export async function addBookmarksAction(input: unknown) {
  return run(async () => {
    const { text, collectionId, newFolder } = pastedLinks.parse(input);
    const links = parsePastedLinks(text);
    if (!links.length) throw new Error("No web links found in that text");
    let folder = collectionId;
    if (!folder && newFolder)
      folder = (await cols.ensureCollectionPath([newFolder], new Map())) ?? undefined;
    const r = await saves.addBookmarks(links, folder);
    enqueueEnrichment(r.enrich);
    refresh();
    return { added: r.added, existing: r.existing };
  });
}

export async function serendipityAction() {
  return run(async () => saves.serendipityQueue(30));
}

export async function reviewAction(saveId: unknown, decision: unknown) {
  return run(async () => {
    const d = z.enum(["keep", "archive", "favorite", "snooze"]).parse(decision);
    await saves.reviewSave(id.parse(saveId), d);
    if (d !== "keep") refresh(); // sidebar counts
  });
}

export async function getSaveAction(saveId: unknown) {
  return run(async () => saves.getSave(id.parse(saveId)));
}

export async function markOpenedAction(saveId: unknown) {
  return run(async () => saves.markOpened(id.parse(saveId)));
}

const listSchema = z.object({
  view: z.enum(["all", "inbox", "favorites", "archive"]).optional(),
  collectionId: id.optional(),
  sessionId: id.optional(),
  q: z.string().max(500).optional(),
  sort: z.enum(["newest", "oldest", "title", "opened", "relevance"]).optional(),
  offset: z.number().int().min(0).max(1_000_000).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  natural: z.boolean().optional(),
});

export async function listSavesAction(params: unknown) {
  return run(async () => saves.listSaves(listSchema.parse(params)));
}

export async function mergeSavesAction(keepId: unknown, dropId: unknown) {
  return run(async () => {
    await saves.mergeSaves(id.parse(keepId), id.parse(dropId));
    refresh();
  });
}

export async function dismissDuplicateAction(a: unknown, b: unknown) {
  return run(async () => {
    await dismissDuplicate(id.parse(a), id.parse(b));
    refresh();
  });
}

export async function archiveSaveAction(saveId: unknown) {
  return run(async () => {
    const r = await archiveSave(id.parse(saveId));
    refresh();
    return r;
  });
}

export async function saveArchiveSettingsAction(input: unknown) {
  return run(async () => {
    await saveArchiveSettings(archiveSettingsSchema.partial().parse(input));
    refresh();
  });
}

export async function relatedSavesAction(saveId: unknown) {
  return run(async () => saves.relatedSaves(id.parse(saveId)));
}

export async function refreshMetadataAction(saveId: unknown) {
  return run(async () => {
    await enrichSave(id.parse(saveId));
    refresh();
  });
}

export async function uploadFileAction(form: FormData) {
  return run(async () => {
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No file");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("File is larger than 25 MB");
    const data = new Uint8Array(await file.arrayBuffer());
    const collectionId = form.get("collectionId");
    const title =
      (form.get("title") as string | null)?.trim() ||
      file.name.replace(/\.[a-z0-9]+$/i, "") ||
      "Upload";
    const isScreenshot = /screen ?shot|capture|^screen/i.test(file.name);
    const created = await saves.createSave(
      {
        title: title.slice(0, 500),
        type: "image",
        collectionIds: typeof collectionId === "string" && collectionId ? [collectionId] : [],
      },
      { captureMethod: "upload" },
    );
    try {
      const stored = await storeFile(data, {
        saveId: created.id,
        kind: "upload",
        originalName: file.name,
      });
      const type =
        stored.mime === "application/pdf" ? "pdf" : isScreenshot ? "screenshot" : "image";
      await saves.updateSave(created.id, { type });
      if (type !== "pdf") enqueueOcr([created.id]);
    } catch (err) {
      await saves.deleteSaves([created.id]);
      throw err;
    }
    refresh();
    return { id: created.id };
  });
}

/* ------------------------------------------------------------ AI (optional) */

export async function ocrSaveAction(saveId: unknown) {
  return run(async () => {
    const chars = await ocrSave(id.parse(saveId));
    refresh();
    return chars;
  });
}

export async function suggestAiAction(saveId: unknown) {
  return run(async () => {
    const s = await suggestForSave(id.parse(saveId));
    return s;
  });
}

const applyAiSchema = z.object({
  title: z.boolean().optional(),
  description: z.boolean().optional(),
  summary: z.boolean().optional(),
  tags: z.boolean().optional(),
  collection: z.boolean().optional(),
});

export async function applyAiAction(saveId: unknown, fields: unknown) {
  return run(async () => {
    const sid = id.parse(saveId);
    const f = applyAiSchema.parse(fields);
    const db = await getDb();
    const detail = await saves.getSave(sid);
    const ai = (detail?.metadata?.ai ?? null) as null | {
      title?: string;
      description?: string;
      summary?: string;
      tags?: string[];
      collectionId?: string | null;
    };
    if (!detail || !ai) throw new Error("No AI suggestion to apply");
    const patch: z.infer<typeof updateSaveInput> = {};
    if (f.title && ai.title) patch.title = ai.title;
    if (f.description && ai.description) patch.description = ai.description;
    if (f.tags && ai.tags?.length) patch.tags = [...new Set([...detail.tags, ...ai.tags])];
    if (f.collection && ai.collectionId)
      patch.collectionIds = [...new Set([...detail.collections.map((c) => c.id), ai.collectionId])];
    const { ai: _drop, ...rest } = detail.metadata ?? {};
    void _drop;
    patch.metadata = rest;
    await saves.updateSave(sid, updateSaveInput.parse(patch));
    if (f.summary && ai.summary) {
      await db.update(schema.saves).set({ aiSummary: ai.summary }).where(eq(schema.saves.id, sid));
      const { reindexSave } = await import("./search");
      await reindexSave(db, sid);
    }
    refresh();
  });
}

export async function dismissAiAction(saveId: unknown) {
  return run(async () => {
    const sid = id.parse(saveId);
    const detail = await saves.getSave(sid);
    if (!detail) return;
    const { ai: _drop, ...rest } = detail.metadata ?? {};
    void _drop;
    await saves.updateSave(sid, { metadata: rest });
  });
}

/* -------------------------------------------------------------- collections */

const collectionSchema = collectionInput.extend({ rules: smartRules.nullable().optional() });

export async function createCollectionAction(input: unknown) {
  return run(async () => {
    const newId = await cols.createCollection(collectionSchema.parse(input));
    refresh();
    return { id: newId };
  });
}

export async function updateCollectionAction(collectionId: unknown, input: unknown) {
  return run(async () => {
    await cols.updateCollection(id.parse(collectionId), collectionSchema.partial().parse(input));
    refresh();
  });
}

export async function deleteCollectionAction(collectionId: unknown) {
  return run(async () => {
    await cols.deleteCollection(id.parse(collectionId));
    refresh();
  });
}

export async function previewRulesAction(rules: unknown) {
  return run(async () => cols.previewRules(smartRules.parse(rules)));
}

/* ----------------------------------------------------------------- sessions */

export async function updateSessionAction(sessionId: unknown, input: unknown) {
  return run(async () => {
    const data = z
      .object({
        name: z.string().max(200).optional(),
        notes: z.string().max(10_000).nullable().optional(),
      })
      .parse(input);
    await sess.updateSession(id.parse(sessionId), data);
    refresh();
  });
}

export async function deleteSessionAction(sessionId: unknown) {
  return run(async () => {
    await sess.deleteSession(id.parse(sessionId));
    refresh();
  });
}

export async function markSessionRestoredAction(sessionId: unknown) {
  return run(async () => {
    await sess.markSessionRestored(id.parse(sessionId));
    refresh();
  });
}

/* --------------------------------------------------------------------- tags */

export async function renameTagAction(tagId: unknown, name: unknown) {
  return run(async () => {
    await tagsRepo.renameTag(id.parse(tagId), z.string().min(1).max(64).parse(name));
    refresh();
  });
}

export async function deleteTagAction(tagId: unknown) {
  return run(async () => {
    await tagsRepo.deleteTag(id.parse(tagId));
    refresh();
  });
}

/* ----------------------------------------------------------------- settings */

export async function createTokenAction(name: unknown) {
  return run(async () => {
    const t = await tokens.createApiToken(
      z
        .string()
        .max(80)
        .parse(name ?? ""),
    );
    refresh();
    return t;
  });
}

export async function revokeTokenAction(tokenId: unknown) {
  return run(async () => {
    await tokens.revokeApiToken(id.parse(tokenId));
    refresh();
  });
}

export async function saveAiSettingsAction(input: unknown) {
  return run(async () => {
    await saveAiSettings(aiSettingsSchema.partial().parse(input));
    // A new embedding model makes old vectors incomparable: drop them and re-index.
    await pruneStaleEmbeddings();
    await queueMissingEmbeddings();
    refresh();
  });
}

export async function clearAiKeyAction() {
  return run(async () => {
    await clearAiKey();
    refresh();
  });
}

export async function testAiAction() {
  return run(async () => testAiConnection(await getAiSettings()));
}

/** Embeds every save that has no vector yet. Runs in the background; returns how many were queued. */
export async function indexEmbeddingsAction() {
  return run(async () => {
    const queued = await queueMissingEmbeddings();
    void flushEmbeddings().catch(() => {});
    return queued;
  });
}

export async function checkLinkAction(saveId: unknown) {
  return run(async () => {
    const r = await checkLink(id.parse(saveId));
    refresh();
    return r;
  });
}

export async function checkLinksNowAction() {
  return run(async () => {
    const r = await checkLinksBatch(100);
    refresh();
    return r;
  });
}

export async function saveLinkCheckSettingsAction(input: unknown) {
  return run(async () => {
    await saveLinkCheckSettings(z.object({ auto: z.boolean() }).parse(input));
    refresh();
  });
}

export async function saveBackupSettingsAction(input: unknown) {
  return run(async () => {
    await saveBackupSettings(backupSettingsSchema.partial().parse(input));
    refresh();
  });
}

/* ------------------------------------------------------------------ sync */

export async function enableSyncAction(input: unknown) {
  return run(async () => {
    const data = z
      .object({ folder: z.string().trim().min(1).max(1000), passphrase: z.string().max(500) })
      .parse(input);
    const r = await enableSync(data);
    refresh();
    return r;
  });
}

export async function disableSyncAction(mode: unknown) {
  return run(async () => {
    await disableSync(z.enum(["keep", "remove", "erase"]).parse(mode ?? "keep"));
    refresh();
  });
}

export async function changeSyncPassphraseAction(input: unknown) {
  return run(async () => {
    await changePassphrase(
      z.object({ current: z.string().max(500), next: z.string().max(500) }).parse(input),
    );
    refresh();
  });
}

export async function syncNowAction() {
  return run(async () => {
    await syncNow();
    refresh();
  });
}

export async function backupNowAction() {
  return run(async () => {
    const name = await writeBackupFile();
    refresh();
    return name;
  });
}

export async function importAction(form: FormData) {
  return run(async () => {
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a file to import");
    if (file.size > MAX_IMPORT_BYTES) throw new Error("Import files are limited to 20 MB");
    const result = await importAuto(file.name, await file.text());
    refresh();
    return result;
  });
}

/* --------------------------------------------------------------------- auth */

export async function loginAction(_prev: unknown, form: FormData): Promise<{ error?: string }> {
  const h = await headers();
  const ip = clientIp(h);
  if (!rateLimit(`login:${ip}`, 5))
    return { error: "Too many attempts. Wait a minute and try again." };
  const password = String(form.get("password") ?? "");
  if (!checkPassword(password)) return { error: "Wrong password." };
  const secure =
    (h.get("x-forwarded-proto") ?? "").includes("https") || process.env.TYMO_SECURE_COOKIES === "1";
  (await cookies()).set(SESSION_COOKIE, issueSessionCookie(), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  const next = String(form.get("next") ?? "/");
  // Only allow local paths (no open redirect).
  redirect(next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/");
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
