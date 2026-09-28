"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  Archive,
  Unlink,
  ArchiveRestore,
  BookDown,
  BookOpen,
  Bookmark,
  Check,
  Copy,
  ExternalLink,
  Inbox,
  ScanText,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  X,
  History,
} from "lucide-react";
import { SAVE_TYPES, SAVE_TYPE_LABELS, safeHref, type SaveType } from "@tymo/core";
import { readingMinutes } from "@tymo/core/reader";
import type { SaveDetail, SaveView } from "@/server/saves";
import {
  applyAiAction,
  archiveSaveAction,
  checkLinkAction,
  bulkAction,
  dismissAiAction,
  getSaveAction,
  markOpenedAction,
  ocrSaveAction,
  refreshMetadataAction,
  relatedSavesAction,
  suggestAiAction,
  updateSaveAction,
} from "@/server/actions";
import { cn, formatBytes, fullDate, imageSrc, isTyping } from "@/lib/format";
import { useApp } from "./app-context";
import { Favicon } from "./favicon";
import { TagInput } from "./tag-input";
import { SnoozeMenu } from "./snooze-menu";
import { formatSnooze } from "@/lib/snooze";
import { Button, IconButton, Tag } from "./ui";

type AiSuggestion = {
  title?: string;
  description?: string;
  summary?: string;
  tags?: string[];
  collection?: string | null;
  collectionId?: string | null;
};

export function SaveDetailSheet() {
  const { detailId, openSave, toast, collections, aiEnabled } = useApp();
  const router = useRouter();
  const [save, setSave] = useState<SaveDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "", notes: "", url: "" });
  const [pending, start] = useTransition();
  const [aiBusy, setAiBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    const res = await getSaveAction(id);
    if (res.ok && res.data) {
      setSave(res.data);
      setDraft({
        title: res.data.title,
        description: res.data.description ?? "",
        notes: res.data.notes ?? "",
        url: res.data.url ?? "",
      });
    } else setSave(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!detailId) {
      setSave(null);
      return;
    }
    setLoading(true);
    void load(detailId);
  }, [detailId, load]);

  // Poll briefly while metadata is being fetched in the background.
  useEffect(() => {
    if (!save || save.metadataStatus !== "pending") return;
    const t = setTimeout(() => load(save.id), 1500);
    return () => clearTimeout(t);
  }, [save, load]);

  useEffect(() => {
    if (!detailId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) openSave(null);
      if (e.key === "b" && !isTyping(e) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        document.querySelector<HTMLButtonElement>("[data-bookmark-toggle]")?.click();
      }
      if (e.key === "r" && !isTyping(e) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        openSave(null);
        router.push(`/read/${detailId}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailId, openSave, router]);

  if (!detailId) return null;

  const patch = (input: Parameters<typeof updateSaveAction>[1], message?: string) =>
    start(async () => {
      const res = await updateSaveAction(save!.id, input);
      if (!res.ok) return toast(res.error, { tone: "error" });
      if (message) toast(message, { tone: "success" });
      await load(save!.id);
      router.refresh();
    });

  const blurSave = (field: "title" | "description" | "notes" | "url") => {
    if (!save) return;
    const current =
      field === "title" ? save.title : field === "url" ? (save.url ?? "") : (save[field] ?? "");
    if (draft[field] === current) return;
    if (field === "url" && draft.url && !safeHref(draft.url))
      return toast("URL must start with http:// or https://", { tone: "error" });
    patch({ [field]: field === "title" ? draft.title : draft[field] || null });
  };

  const bulk = (
    kind: "archive" | "unarchive" | "delete" | "done" | "inbox" | "bookmark" | "unbookmark",
    message: string,
  ) => {
    if (kind === "delete" && !confirm("Delete this save? This can't be undone.")) return;
    start(async () => {
      const res = await bulkAction([save!.id], { kind });
      if (!res.ok) return toast(res.error, { tone: "error" });
      toast(message, { tone: "success" });
      if (kind === "delete") openSave(null);
      else await load(save!.id);
      router.refresh();
    });
  };

  const ai = (save?.metadata?.ai ?? null) as AiSuggestion | null;
  const href = save
    ? (safeHref(save.url) ?? (save.fileId ? `/files/${save.fileId}` : undefined))
    : undefined;
  const imageFile = save?.files.find((f) => f.mime.startsWith("image/"));
  const readableImage =
    !!imageFile || (!!save?.imageUrl && ["image", "product"].includes(save.type));
  const imageDescription =
    typeof save?.metadata?.imageDescription === "string" ? save.metadata.imageDescription : null;
  const snapshot = save?.files.find((f) => f.kind === "snapshot");
  const archive = () =>
    start(async () => {
      const res = await archiveSaveAction(save!.id);
      if (!res.ok) return toast(res.error, { tone: "error" });
      toast(`Page archived · ${formatBytes(res.data.size)}`, { tone: "success" });
      await load(save!.id);
    });

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal aria-label="Save details">
      <div className="absolute inset-0 bg-black/40" onClick={() => openSave(null)} />
      <aside className="absolute inset-y-0 right-0 flex w-[min(520px,100vw)] animate-slide flex-col border-l border-border bg-surface shadow-elevated">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
          <span className="eyebrow flex-1 pl-1">
            {save ? SAVE_TYPE_LABELS[save.type] : "Loading"}
          </span>
          {save && (
            <>
              <IconButton
                label={save.isBookmark ? "Remove from Bookmarks" : "Add to Bookmarks (B)"}
                onClick={() =>
                  bulk(
                    save.isBookmark ? "unbookmark" : "bookmark",
                    save.isBookmark ? "Removed from Bookmarks" : "Added to Bookmarks",
                  )
                }
                className={save.isBookmark ? "text-accent-ink" : ""}
                disabled={!save.url}
                data-bookmark-toggle
              >
                <Bookmark size={15} fill={save.isBookmark ? "currentColor" : "none"} />
              </IconButton>
              <IconButton
                label={save.isFavorite ? "Unfavorite" : "Favorite"}
                onClick={() => patch({ favorite: !save.isFavorite })}
                className={save.isFavorite ? "text-warn" : ""}
              >
                <Star size={15} fill={save.isFavorite ? "currentColor" : "none"} />
              </IconButton>
              {save.status === "inbox" && !save.isArchived ? (
                <IconButton
                  label="Mark done (leave Inbox)"
                  onClick={() => bulk("done", "Marked as done")}
                >
                  <Check size={15} />
                </IconButton>
              ) : (
                <IconButton label="Move to Inbox" onClick={() => bulk("inbox", "Moved to Inbox")}>
                  <Inbox size={15} />
                </IconButton>
              )}
              {!save.isArchived && (
                <SnoozeMenu
                  label="Snooze (hide from Inbox until…)"
                  onSnooze={(until) =>
                    start(async () => {
                      const res = await bulkAction([save.id], { kind: "snooze", until });
                      if (!res.ok) return toast(res.error, { tone: "error" });
                      toast(`Snoozed until ${formatSnooze(until)}`, { tone: "success" });
                      await load(save.id);
                      router.refresh();
                    })
                  }
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg",
                    !!save.snoozedUntil && "text-accent-ink",
                  )}
                >
                  <AlarmClock size={15} />
                </SnoozeMenu>
              )}
              {save.isArchived ? (
                <IconButton
                  label="Restore from archive"
                  onClick={() => bulk("unarchive", "Restored")}
                >
                  <ArchiveRestore size={15} />
                </IconButton>
              ) : (
                <IconButton label="Archive" onClick={() => bulk("archive", "Archived")}>
                  <Archive size={15} />
                </IconButton>
              )}
              <IconButton
                label="Delete"
                onClick={() => bulk("delete", "Deleted")}
                className="hover:text-danger"
              >
                <Trash2 size={15} />
              </IconButton>
            </>
          )}
          <IconButton label="Close" onClick={() => openSave(null)}>
            <X size={16} />
          </IconButton>
        </header>

        {loading || !save ? (
          <div className="flex flex-1 items-center justify-center text-muted">
            {loading ? <Loader2 className="animate-spin" size={18} /> : "Not found"}
          </div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {imageFile ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/files/${imageFile.id}`}
                alt={save.title}
                className="max-h-72 w-full rounded-lg border border-border bg-surface-2 object-contain"
              />
            ) : (
              imageSrc(save.imageUrl) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageSrc(save.imageUrl)}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="max-h-56 w-full rounded-lg border border-border object-cover"
                />
              )
            )}

            {save.linkStatus && (
              <LinkStatusBanner
                save={save}
                snapshotId={snapshot?.id}
                busy={pending}
                onRecheck={() =>
                  start(async () => {
                    const res = await checkLinkAction(save.id);
                    if (!res.ok) return toast(res.error, { tone: "error" });
                    toast(
                      res.data ? `Link status: ${res.data.status}` : "This link can't be checked",
                    );
                    await load(save.id);
                  })
                }
                onUseNewUrl={(url) => {
                  setDraft({ ...draft, url });
                  patch({ url }, "URL updated");
                }}
              />
            )}

            {save.snoozedUntil && (
              <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
                <AlarmClock size={14} className="text-accent-ink" />
                <span className="flex-1">
                  Snoozed until{" "}
                  <strong className="font-medium">{formatSnooze(save.snoozedUntil)}</strong>
                </span>
                <button
                  type="button"
                  className="font-mono text-2xs text-accent-ink hover:underline"
                  onClick={() =>
                    start(async () => {
                      await bulkAction([save.id], { kind: "snooze", until: null });
                      await load(save.id);
                      router.refresh();
                    })
                  }
                >
                  UNSNOOZE
                </button>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-start gap-2.5">
                <Favicon
                  url={save.faviconUrl}
                  domain={save.domain}
                  type={save.type}
                  size={20}
                  className="mt-1"
                />
                <textarea
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  onBlur={() => blurSave("title")}
                  rows={1}
                  aria-label="Title"
                  className="field-sizing-content w-full resize-none bg-transparent text-lg leading-snug font-semibold outline-none"
                />
              </div>
              {(href || save.body) && (
                <div className="flex items-center gap-2">
                  {href && (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => markOpenedAction(save.id)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover"
                    >
                      <ExternalLink size={14} /> Open
                    </a>
                  )}
                  <Link
                    href={`/read/${save.id}`}
                    onClick={() => openSave(null)}
                    title="Read a clean, formatted version (R)"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 text-sm font-medium hover:border-border-strong"
                  >
                    <BookOpen size={13} /> Read
                    {typeof save.metadata?.words === "number" && save.metadata.words > 60 && (
                      <span className="font-mono text-2xs text-muted">
                        {readingMinutes(save.metadata.words)}m
                      </span>
                    )}
                  </Link>
                  {save.url && (
                    <Button
                      onClick={() => {
                        void navigator.clipboard.writeText(save.url!);
                        toast("Link copied");
                      }}
                    >
                      <Copy size={13} /> Copy link
                    </Button>
                  )}
                  {snapshot ? (
                    <a
                      href={`/files/${snapshot.id}`}
                      target="_blank"
                      rel="noopener"
                      title="Open the archived copy saved by Tymo"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 text-sm font-medium hover:border-border-strong"
                    >
                      <BookDown size={13} /> Archived copy
                    </a>
                  ) : (
                    save.url && (
                      <Button onClick={archive} disabled={pending} title="Save an offline copy">
                        <BookDown size={13} /> Archive page
                      </Button>
                    )
                  )}
                  <span className="truncate font-mono text-2xs text-muted">{save.domain}</span>
                </div>
              )}
            </div>

            {aiEnabled && (
              <section className="rounded-lg border border-border bg-surface-2/40 p-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-accent-ink" />
                  <span className="eyebrow flex-1">AI suggestions</span>
                  {!ai && (
                    <Button
                      size="sm"
                      disabled={aiBusy}
                      onClick={async () => {
                        setAiBusy(true);
                        const res = await suggestAiAction(save.id);
                        setAiBusy(false);
                        if (!res.ok) toast(res.error, { tone: "error" });
                        await load(save.id);
                      }}
                    >
                      {aiBusy ? <Loader2 size={12} className="animate-spin" /> : null} Suggest
                    </Button>
                  )}
                </div>
                {ai && (
                  <AiPanel
                    ai={ai}
                    onApply={(fields) =>
                      start(async () => {
                        const res = await applyAiAction(save.id, fields);
                        if (!res.ok) return toast(res.error, { tone: "error" });
                        toast("Applied", { tone: "success" });
                        await load(save.id);
                        router.refresh();
                      })
                    }
                    onDismiss={() =>
                      start(async () => {
                        await dismissAiAction(save.id);
                        await load(save.id);
                      })
                    }
                  />
                )}
              </section>
            )}

            <Field label="Tags">
              <TagInput value={save.tags} onChange={(tags) => patch({ tags })} />
            </Field>

            <Field label="Collections">
              <div className="flex flex-wrap gap-1.5">
                {collections
                  .filter((c) => !c.smart)
                  .map((c) => {
                    const on = save.collections.some((x) => x.id === c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          patch({
                            collectionIds: on
                              ? save.collections.filter((x) => x.id !== c.id).map((x) => x.id)
                              : [...save.collections.map((x) => x.id), c.id],
                          })
                        }
                        className={cn(
                          "h-7 rounded-md border px-2 text-xs transition-colors",
                          on
                            ? "border-accent/60 bg-accent-soft text-fg"
                            : "border-border text-fg-2 hover:border-border-strong hover:text-fg",
                        )}
                      >
                        {c.icon ? `${c.icon} ` : ""}
                        {c.name}
                      </button>
                    );
                  })}
                {collections.filter((c) => !c.smart).length === 0 && (
                  <p className="text-xs text-muted">No collections yet.</p>
                )}
              </div>
            </Field>

            <Field label="Notes">
              <textarea
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                onBlur={() => blurSave("notes")}
                placeholder="Why did you save this?"
                rows={3}
                aria-label="Notes"
                className="input field-sizing-content min-h-20 resize-y"
              />
            </Field>

            <Field label="Description">
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                onBlur={() => blurSave("description")}
                rows={2}
                aria-label="Description"
                className="input field-sizing-content resize-y text-fg-2"
              />
            </Field>

            {save.aiSummary && (
              <Field label="Summary">
                <p className="text-sm leading-relaxed text-fg-2">{save.aiSummary}</p>
              </Field>
            )}

            {(save.imageText || imageDescription || (aiEnabled && readableImage)) && (
              <Field label="In the image">
                {imageDescription && (
                  <p className="mb-2 text-sm leading-relaxed text-fg-2">{imageDescription}</p>
                )}
                {save.imageText && (
                  <p className="mb-2 max-h-60 overflow-y-auto rounded-lg border border-border bg-surface-2/40 p-3 font-mono text-xs whitespace-pre-wrap text-fg-2">
                    {save.imageText}
                  </p>
                )}
                {aiEnabled && readableImage && (
                  <Button
                    size="sm"
                    disabled={aiBusy}
                    onClick={async () => {
                      setAiBusy(true);
                      const res = await ocrSaveAction(save.id);
                      setAiBusy(false);
                      if (!res.ok) return toast(res.error, { tone: "error" });
                      toast(res.data ? "Image described" : "Nothing recognisable found", {
                        tone: res.data ? "success" : "default",
                      });
                      await load(save.id);
                    }}
                  >
                    {aiBusy ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <ScanText size={12} />
                    )}{" "}
                    {imageDescription || save.imageText ? "Read again" : "Describe & read text"}
                  </Button>
                )}
              </Field>
            )}

            {save.body && (
              <Field label={save.type === "note" ? "Note" : "Text"}>
                <p className="rounded-lg border border-border bg-surface-2/40 p-3 text-sm whitespace-pre-wrap text-fg-2">
                  {save.body}
                </p>
              </Field>
            )}

            {save.sessions.length > 0 && (
              <Field label="Sessions">
                <div className="flex flex-wrap gap-1.5">
                  {save.sessions.map((s) => (
                    <Link
                      key={s.id}
                      href={`/sessions/${s.id}`}
                      onClick={() => openSave(null)}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-fg-2 hover:text-fg"
                    >
                      <History size={12} /> {s.name}
                    </Link>
                  ))}
                </div>
              </Field>
            )}

            <RelatedSaves saveId={save.id} onOpen={openSave} />

            <details className="group">
              <summary className="eyebrow cursor-pointer list-none hover:text-fg-2">
                Details ▸
              </summary>
              <div className="mt-3 space-y-3">
                <Field label="URL">
                  <input
                    value={draft.url}
                    onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                    onBlur={() => blurSave("url")}
                    className="input font-mono text-xs"
                    aria-label="URL"
                  />
                </Field>
                <Field label="Type">
                  <select
                    value={save.type}
                    onChange={(e) => patch({ type: e.target.value as SaveType })}
                    className="input h-8 py-0"
                    aria-label="Type"
                  >
                    {SAVE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {SAVE_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </Field>
                <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 font-mono text-2xs">
                  <dt className="text-muted">SAVED</dt>
                  <dd className="text-fg-2">{fullDate(save.createdAt)}</dd>
                  <dt className="text-muted">UPDATED</dt>
                  <dd className="text-fg-2">{fullDate(save.updatedAt)}</dd>
                  <dt className="text-muted">OPENED</dt>
                  <dd className="text-fg-2">
                    {save.openCount}×{" "}
                    {save.lastOpenedAt ? `· last ${fullDate(save.lastOpenedAt)}` : ""}
                  </dd>
                  <dt className="text-muted">CAPTURED VIA</dt>
                  <dd className="text-fg-2">{save.captureMethod}</dd>
                  <dt className="text-muted">METADATA</dt>
                  <dd className="flex items-center gap-2 text-fg-2">
                    {save.metadataStatus}
                    {save.extractedTextLength > 0 &&
                      ` · ${formatBytes(save.extractedTextLength)} text indexed`}
                    {save.url && (
                      <button
                        type="button"
                        className="text-accent-ink hover:underline"
                        onClick={() =>
                          start(async () => {
                            const res = await refreshMetadataAction(save.id);
                            toast(res.ok ? "Metadata refreshed" : res.error, {
                              tone: res.ok ? "success" : "error",
                            });
                            await load(save.id);
                          })
                        }
                      >
                        <RefreshCw size={11} className={cn("inline", pending && "animate-spin")} />{" "}
                        refresh
                      </button>
                    )}
                  </dd>
                  {save.files.map((f) => (
                    <div key={f.id} className="contents">
                      <dt className="text-muted">FILE</dt>
                      <dd>
                        <a
                          href={`/files/${f.id}`}
                          target="_blank"
                          rel="noopener"
                          className="text-accent-ink hover:underline"
                        >
                          {f.kind === "snapshot" ? "archived page" : f.mime} · {formatBytes(f.size)}
                        </a>
                        {f.kind === "snapshot" && (
                          <button
                            type="button"
                            className="ml-2 text-accent-ink hover:underline"
                            onClick={archive}
                          >
                            re-archive
                          </button>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </details>
          </div>
        )}
      </aside>
    </div>
  );
}

function LinkStatusBanner({
  save,
  snapshotId,
  busy,
  onRecheck,
  onUseNewUrl,
}: {
  save: SaveDetail;
  snapshotId?: string;
  busy: boolean;
  onRecheck: () => void;
  onUseNewUrl: (url: string) => void;
}) {
  const check = (save.metadata?.linkCheck ?? {}) as {
    code?: number | null;
    checkedAt?: number;
    finalUrl?: string;
    reason?: string;
  };
  const when = check.checkedAt ? new Date(check.checkedAt).toLocaleDateString() : "recently";
  const moved = save.linkStatus === "moved" ? safeHref(check.finalUrl) : undefined;
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border px-3 py-2 text-sm",
        moved ? "border-border bg-surface-2/40" : "border-danger/40 bg-danger-soft",
      )}
    >
      <div className="flex items-start gap-2">
        <Unlink size={14} className={cn("mt-0.5 shrink-0", moved ? "text-fg-2" : "text-danger")} />
        <p className="min-w-0 flex-1">
          {moved ? (
            <>
              This page now redirects to{" "}
              <span className="font-mono text-xs break-all text-fg-2">{moved}</span>
            </>
          ) : (
            <>
              This link looks dead
              {check.code ? ` (HTTP ${check.code})` : check.reason ? ` (${check.reason})` : ""} —
              checked {when}.{" "}
              {snapshotId ? "Your archived copy still works." : "There is no archived copy."}
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 pl-6">
        {moved && (
          <Button size="sm" onClick={() => onUseNewUrl(moved)} disabled={busy}>
            Use new URL
          </Button>
        )}
        {!moved && snapshotId && (
          <a
            href={`/files/${snapshotId}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-7 items-center rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium hover:border-border-strong"
          >
            Open archived copy
          </a>
        )}
        <Button size="sm" variant="ghost" onClick={onRecheck} disabled={busy}>
          Check again
        </Button>
      </div>
    </div>
  );
}

function RelatedSaves({ saveId, onOpen }: { saveId: string; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<SaveView[] | null>(null);
  useEffect(() => {
    let live = true;
    void relatedSavesAction(saveId).then((res) => {
      if (live) setItems(res.ok ? res.data : []);
    });
    return () => {
      live = false;
      setItems(null);
    };
  }, [saveId]);
  if (!items?.length) return null;
  return (
    <Field label="Related">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onOpen(r.id)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              <Favicon url={r.faviconUrl} domain={r.domain} type={r.type} size={14} />
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              {r.domain && (
                <span className="shrink-0 font-mono text-2xs text-muted">{r.domain}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function AiPanel({
  ai,
  onApply,
  onDismiss,
}: {
  ai: AiSuggestion;
  onApply: (f: Record<string, boolean>) => void;
  onDismiss: () => void;
}) {
  const [pick, setPick] = useState<Record<string, boolean>>({
    title: !!ai.title,
    description: !!ai.description,
    summary: !!ai.summary,
    tags: !!ai.tags?.length,
    collection: !!ai.collectionId,
  });
  const row = (key: string, label: string, content: React.ReactNode) => (
    <label className="flex cursor-pointer items-start gap-2.5 py-1.5 text-sm">
      <input
        type="checkbox"
        checked={pick[key] ?? false}
        onChange={(e) => setPick({ ...pick, [key]: e.target.checked })}
        className="mt-1 accent-accent"
      />
      <span className="w-20 shrink-0 font-mono text-2xs text-muted uppercase">{label}</span>
      <span className="min-w-0 flex-1 text-fg-2">{content}</span>
    </label>
  );
  return (
    <div className="mt-2">
      {ai.title && row("title", "Title", ai.title)}
      {ai.description && row("description", "Desc", ai.description)}
      {ai.tags?.length
        ? row(
            "tags",
            "Tags",
            <span className="flex flex-wrap gap-1">
              {ai.tags.map((t) => (
                <Tag key={t} name={t} />
              ))}
            </span>,
          )
        : null}
      {ai.collectionId && row("collection", "Collection", ai.collection)}
      {ai.summary &&
        row("summary", "Summary", <span className="text-xs leading-relaxed">{ai.summary}</span>)}
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
        <Button size="sm" variant="primary" onClick={() => onApply(pick)}>
          Apply selected
        </Button>
      </div>
    </div>
  );
}
