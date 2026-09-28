"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Upload } from "lucide-react";
import { isHttpUrl, SAVE_TYPE_LABELS, safeHref, type SaveType } from "@tymo/core";
import { createSaveAction, previewUrlAction, uploadFileAction } from "@/server/actions";
import { imageSrc, isTyping } from "@/lib/format";
import { useApp } from "./app-context";
import { Favicon } from "./favicon";
import { CollectionSelect, TagInput } from "./tag-input";
import { Button, Dialog } from "./ui";

type Preview = {
  title: string;
  description: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
  type: SaveType;
  existingId: string | null;
};

function looksLikeUrl(v: string) {
  const t = v.trim();
  if (isHttpUrl(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) && !t.includes(" ")) return "https://" + t;
  return null;
}

export function QuickSave() {
  const { quickSave, closeQuickSave, openQuickSave, toast, openSave } = useApp();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [collectionId, setCollectionId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  // Plain state, not useTransition: a transition would stay pending through router.refresh()
  // and silently swallow a second quick save made while the page re-renders.
  const [saving, setSaving] = useState(false);
  const startSaving = (fn: () => Promise<void>) => {
    setSaving(true);
    void fn().finally(() => setSaving(false));
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const url = looksLikeUrl(input);

  // Global shortcuts: "n" opens quick save; pasting a URL anywhere opens it prefilled.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "n" &&
        !isTyping(e) &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        openQuickSave();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e as unknown as KeyboardEvent) || document.querySelector("dialog[open]")) return;
      const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
      if (isHttpUrl(text)) {
        e.preventDefault();
        openQuickSave(text);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, [openQuickSave]);

  useEffect(() => {
    if (quickSave.open) {
      setInput(quickSave.prefill ?? "");
      setTitle("");
      setTitleTouched(false);
      setTags([]);
      setPreview(null);
      const path = window.location.pathname.match(/^\/collections\/([^/]+)/);
      setCollectionId(path?.[1] ?? "");
    }
  }, [quickSave.open, quickSave.prefill]);

  useEffect(() => {
    if (!url) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    const t = setTimeout(async () => {
      const res = await previewUrlAction(url);
      if (cancelled) return;
      setLoadingPreview(false);
      if (res.ok) {
        setPreview(res.data);
        if (!titleTouched) setTitle(res.data.title);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [url, titleTouched]);

  const submit = () => {
    if (!input.trim() || saving) return;
    startSaving(async () => {
      const body = url ? undefined : input;
      const res = await createSaveAction({
        url: url ?? undefined,
        title: title.trim() || undefined,
        body,
        type: url ? undefined : "note",
        description: url ? (preview?.description ?? undefined) : undefined,
        imageUrl: safeHref(preview?.imageUrl),
        faviconUrl: safeHref(preview?.faviconUrl),
        tags,
        collectionIds: collectionId ? [collectionId] : [],
      });
      if (!res.ok) {
        toast(res.error, { tone: "error" });
        return;
      }
      closeQuickSave();
      toast(
        res.data.duplicate
          ? "Already saved — updated it"
          : collectionId
            ? "Saved"
            : "Saved to Inbox",
        {
          tone: "success",
          action: { label: "Open", onClick: () => openSave(res.data.id) },
        },
      );
      router.refresh();
    });
  };

  const upload = (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    if (collectionId) fd.set("collectionId", collectionId);
    startSaving(async () => {
      const res = await uploadFileAction(fd);
      if (!res.ok) return toast(res.error, { tone: "error" });
      closeQuickSave();
      toast(`Uploaded ${file.name}`, {
        tone: "success",
        action: { label: "Open", onClick: () => openSave(res.data.id) },
      });
      router.refresh();
    });
  };

  return (
    <Dialog
      open={quickSave.open}
      onClose={closeQuickSave}
      labelledBy="quick-save-title"
      className="w-[min(520px,calc(100vw-32px))]"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) upload(f);
        }}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 id="quick-save-title" className="eyebrow text-fg-2">
            Save
          </h2>
          <span className="touch-hidden font-mono text-2xs text-muted">
            <kbd className="kbd">⌘</kbd> <kbd className="kbd">↵</kbd> save ·{" "}
            <kbd className="kbd">esc</kbd>
          </span>
        </div>
        <div className="space-y-3 p-4">
          <div className="relative">
            <textarea
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={url ? 1 : 3}
              placeholder="Paste a link, or write a note…"
              aria-label="URL or note"
              className="input resize-none pr-9 font-mono text-[13px]"
            />
            <span className="pointer-events-none absolute top-2.5 right-3 text-muted">
              {loadingPreview ? (
                <Loader2 size={14} className="animate-spin" />
              ) : url ? (
                <Link2 size={14} />
              ) : null}
            </span>
          </div>

          {url && (
            <div className="flex gap-3 rounded-lg border border-border bg-surface-2/50 p-2.5">
              {preview?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageSrc(preview.imageUrl)}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-14 w-24 shrink-0 rounded-md border border-border object-cover"
                />
              ) : (
                <div className="bg-blueprint flex h-14 w-24 shrink-0 items-center justify-center rounded-md border border-border">
                  <Favicon url={preview?.faviconUrl} domain={new URL(url).hostname} size={20} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setTitleTouched(true);
                  }}
                  placeholder={loadingPreview ? "Fetching title…" : "Title"}
                  aria-label="Title"
                  className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted"
                />
                <p className="mt-0.5 line-clamp-2 text-xs text-fg-2">
                  {preview?.description ?? new URL(url).hostname}
                </p>
                <div className="mt-1 flex gap-2 font-mono text-2xs text-muted">
                  {preview && <span>{SAVE_TYPE_LABELS[preview.type].toUpperCase()}</span>}
                  {preview?.existingId && (
                    <span className="text-warn">ALREADY SAVED — WILL MERGE</span>
                  )}
                </div>
              </div>
            </div>
          )}
          {!url && input.trim() && (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              aria-label="Title"
              className="input"
            />
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_1fr]">
            <CollectionSelect value={collectionId} onChange={setCollectionId} />
            <TagInput value={tags} onChange={setTags} />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={saving}
          >
            <Upload size={13} /> Upload file
          </Button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={closeQuickSave}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!input.trim() || saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : null} Save
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
