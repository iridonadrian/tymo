"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Sparkles, X } from "lucide-react";
import type { OrganizePlan } from "@/server/organize";
import { applyOrganizeAction, planOrganizeAction, undoOrganizeAction } from "@/server/actions";
import { useApp } from "./app-context";
import { Button, Dialog } from "./ui";

type Folder = OrganizePlan["folders"][number] & { key: string; keep: boolean };

/**
 * Bookmarks → Organize with AI: the AI proposes folders (and tags), the user reviews and
 * edits them, and Apply files everything at once. Nothing is clicked or typed for you.
 */
export function OrganizeDialog({
  open,
  onClose,
  aiEnabled,
  scope = "bookmarks",
}: {
  open: boolean;
  onClose: () => void;
  aiEnabled: boolean;
  /** Bookmarks page, or the Inbox (items are filed into collections and leave the Inbox). */
  scope?: "bookmarks" | "inbox";
}) {
  const inbox = scope === "inbox";
  const noun = inbox ? "items" : "bookmarks";
  const [markDone, setMarkDone] = useState(true);
  const router = useRouter();
  const { toast } = useApp();
  const [withTags, setWithTags] = useState(true);
  const [busy, setBusy] = useState<null | "plan" | "apply">(null);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [tags, setTags] = useState<Record<string, string[]>>({});
  const [unplaced, setUnplaced] = useState(0);

  const reset = () => {
    setFolders(null);
    setTags({});
    setUnplaced(0);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const plan = async () => {
    setBusy("plan");
    const res = await planOrganizeAction({ tags: withTags, scope });
    setBusy(null);
    if (!res.ok) return toast(res.error, { tone: "error" });
    setFolders(res.data.folders.map((f, i) => ({ ...f, key: String(i), keep: true })));
    setTags(res.data.tags);
    setUnplaced(res.data.unplaced.length);
  };

  const apply = async () => {
    if (!folders) return;
    const chosen = folders.filter((f) => f.keep && f.name.trim());
    setBusy("apply");
    const res = await applyOrganizeAction({
      scope,
      markDone,
      folders: chosen.map((f) => ({
        name: f.name.trim(),
        emoji: f.emoji,
        ids: f.items.map((i) => i.id),
      })),
      tags: withTags ? tags : {},
    });
    setBusy(null);
    if (!res.ok) return toast(res.error, { tone: "error" });
    toast(
      inbox && markDone
        ? `Filed ${res.data.moved} items into ${chosen.length} collections · Inbox cleared`
        : `Organized ${res.data.moved} ${noun} into ${chosen.length} ${inbox ? "collections" : "folders"}`,
      {
        tone: "success",
        action: {
          label: "Undo",
          onClick: async () => {
            const u = await undoOrganizeAction();
            if (!u.ok) return toast(u.error, { tone: "error" });
            toast("Back to how it was", { tone: "success" });
            router.refresh();
          },
        },
      },
    );
    reset();
    onClose();
    router.refresh();
  };

  const edit = (key: string, patch: Partial<Folder>) =>
    setFolders((fs) => fs?.map((f) => (f.key === key ? { ...f, ...patch } : f)) ?? null);
  const total = folders?.filter((f) => f.keep).reduce((n, f) => n + f.items.length, 0) ?? 0;

  return (
    <Dialog open={open} onClose={close} title="Organize with AI" className="max-w-2xl">
      <div className="space-y-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles size={14} className="text-accent" /> Organize with AI
          </h2>
          <p className="mt-1 text-xs text-fg-2">
            {inbox
              ? "The AI reads what is in your Inbox and suggests a collection for each item (your existing ones first). "
              : "The AI reads your bookmarks’ titles and sites and suggests folders. "}
            You review them here; nothing changes until you click Apply, and you can undo it.
          </p>
        </div>

        {!aiEnabled ? (
          <div className="rounded-lg border border-border bg-surface-2/40 p-3 text-sm text-fg-2">
            AI is off. Turn it on in{" "}
            <Link href="/settings#ai" className="text-accent hover:underline" onClick={close}>
              Settings → AI
            </Link>
            : free and private with Ollama on this Mac, or paste an Anthropic, OpenAI or Gemini key.
          </div>
        ) : !folders ? (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-fg-2">
              <input
                type="checkbox"
                checked={withTags}
                onChange={(e) => setWithTags(e.target.checked)}
                className="accent-accent"
              />
              Also add tags describing each {inbox ? "item" : "site"} (e.g. fonts, free, ai)
            </label>
            {inbox && (
              <label className="flex items-center gap-2 text-sm text-fg-2">
                <input
                  type="checkbox"
                  checked={markDone}
                  onChange={(e) => setMarkDone(e.target.checked)}
                  className="accent-accent"
                />
                Take them out of the Inbox once filed
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close} disabled={!!busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={plan} disabled={!!busy}>
                {busy === "plan" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Sparkles size={13} />
                )}
                {busy === "plan" ? "Thinking…" : inbox ? "Sort my Inbox" : "Suggest folders"}
              </Button>
            </div>
            {busy === "plan" && (
              <p className="text-right text-2xs text-muted">
                A few seconds with a cloud model, up to a few minutes with a local one.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {folders.map((f) => (
                <div
                  key={f.key}
                  className={`rounded-lg border border-border p-2.5 ${f.keep ? "" : "opacity-50"}`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      value={f.emoji}
                      onChange={(e) => edit(f.key, { emoji: e.target.value })}
                      aria-label="Folder emoji"
                      className="input h-7 w-10 px-1 py-0 text-center"
                    />
                    <input
                      value={f.name}
                      onChange={(e) => edit(f.key, { name: e.target.value })}
                      aria-label="Folder name"
                      className="input h-7 flex-1 py-0 text-sm font-medium"
                    />
                    <span className="font-mono text-2xs text-muted">{f.items.length}</span>
                    <button
                      type="button"
                      onClick={() => edit(f.key, { keep: !f.keep })}
                      aria-label={f.keep ? `Skip ${f.name}` : `Include ${f.name}`}
                      title={f.keep ? "Skip this folder" : "Include this folder"}
                      className="flex size-6 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs text-fg-2">
                    {f.items.map((i) => i.title).join(" · ")}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-2xs text-muted">
              {total} {noun} into {folders.filter((f) => f.keep).length}{" "}
              {inbox ? "collections" : "folders"}
              {withTags && Object.keys(tags).length
                ? `, with tags on ${Object.keys(tags).length}`
                : ""}
              {unplaced ? ` · ${unplaced} left where they are` : ""}. Skipped folders stay as they
              are.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset} disabled={!!busy}>
                Try again
              </Button>
              <Button variant="primary" onClick={apply} disabled={!!busy || !total}>
                {busy === "apply" && <Loader2 size={13} className="animate-spin" />} Apply
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
