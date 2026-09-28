"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import {
  RULE_FIELDS,
  RULE_FIELD_LABELS,
  RULE_OPS,
  RULE_OP_LABELS,
  SAVE_TYPES,
  type RuleCondition,
  type SmartRules,
} from "@tymo/core";
import type { CollectionView } from "@/server/collections";
import {
  createCollectionAction,
  previewRulesAction,
  updateCollectionAction,
} from "@/server/actions";
import { useApp } from "./app-context";
import { Favicon } from "./favicon";
import { Button, Dialog } from "./ui";

const emptyCondition = (): RuleCondition => ({ field: "tag", op: "is", value: "" });

export function CollectionDialog({
  editing,
  onClose,
}: {
  editing?: CollectionView | null;
  onClose?: () => void;
}) {
  const app = useApp();
  const router = useRouter();
  const open = editing ? true : app.collectionDialog.open;
  const close = onClose ?? app.closeCollectionDialog;

  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState("");
  const [smart, setSmart] = useState(false);
  const [groups, setGroups] = useState<RuleCondition[][]>([[emptyCondition()]]);
  const [preview, setPreview] = useState<{
    count: number;
    sample: { id: string; title: string; domain: string | null; faviconUrl: string | null }[];
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setIcon(editing?.icon ?? "");
    setDescription(editing?.description ?? "");
    setParentId(editing?.parentId ?? "");
    setSmart(editing ? editing.smart : !!app.collectionDialog.smart);
    setGroups(editing?.rules?.groups ?? [[emptyCondition()]]);
    setPreview(null);
  }, [open, editing, app.collectionDialog.smart]);

  const validRules: SmartRules | null = (() => {
    const g = groups.map((grp) => grp.filter((c) => c.value.trim())).filter((grp) => grp.length);
    return g.length ? { groups: g } : null;
  })();

  const rulesKey = JSON.stringify(validRules);
  useEffect(() => {
    if (!smart || !validRules) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    const t = setTimeout(async () => {
      const res = await previewRulesAction(validRules);
      setPreviewing(false);
      if (res.ok) setPreview(res.data);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart, rulesKey]);

  const submit = () => {
    if (!name.trim()) return;
    if (smart && !validRules)
      return app.toast("Add at least one rule with a value", { tone: "error" });
    start(async () => {
      const payload = {
        name,
        icon,
        description,
        parentId: parentId || null,
        rules: smart ? validRules : null,
      };
      const res = editing
        ? await updateCollectionAction(editing.id, payload)
        : await createCollectionAction(payload);
      if (!res.ok) return app.toast(res.error, { tone: "error" });
      close();
      app.toast(editing ? "Collection updated" : `Created ${name}`, { tone: "success" });
      if (!editing && res.data) router.push(`/collections/${(res.data as { id: string }).id}`);
      router.refresh();
    });
  };

  const setCond = (gi: number, ci: number, patch: Partial<RuleCondition>) =>
    setGroups((gs) =>
      gs.map((g, i) => (i === gi ? g.map((c, j) => (j === ci ? { ...c, ...patch } : c)) : g)),
    );

  return (
    <Dialog
      open={open}
      onClose={close}
      labelledBy="collection-dialog-title"
      className="w-[min(640px,calc(100vw-32px))]"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      >
        <div className="border-b border-border px-5 py-3">
          <h2 id="collection-dialog-title" className="text-sm font-semibold">
            {editing ? "Edit collection" : smart ? "New smart collection" : "New collection"}
          </h2>
        </div>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto p-5">
          <div className="flex gap-2">
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value.slice(0, 4))}
              placeholder="📁"
              aria-label="Icon (emoji)"
              className="input w-12 text-center"
            />
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Collection name, e.g. Cybersecurity"
              aria-label="Name"
              className="input"
              required
              maxLength={80}
            />
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            aria-label="Description"
            className="input"
            maxLength={1000}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-fg-2">
              <span className="eyebrow mb-1 block">Parent</span>
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="input h-8 py-0"
              >
                <option value="">None (top level)</option>
                {app.collections
                  .filter((c) => c.id !== editing?.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon ? `${c.icon} ` : ""}
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <div>
              <span className="eyebrow mb-1 block">Kind</span>
              <div
                role="radiogroup"
                className="flex h-8 rounded-lg border border-border bg-surface-2 p-0.5 text-xs"
              >
                {[
                  [false, "Manual"],
                  [true, "Smart (rules)"],
                ].map(([v, label]) => (
                  <button
                    key={String(v)}
                    type="button"
                    role="radio"
                    aria-checked={smart === v}
                    onClick={() => setSmart(v as boolean)}
                    className={`flex-1 rounded-md ${smart === v ? "bg-surface-3 text-fg" : "text-fg-2"}`}
                  >
                    {label as string}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {smart && (
            <div className="space-y-2">
              <p className="text-xs text-fg-2">
                Saves appear automatically when they match <strong className="text-fg">any</strong>{" "}
                group. Inside a group, <strong className="text-fg">all</strong> conditions must
                match. You can still add items manually.
              </p>
              {groups.map((g, gi) => (
                <div key={gi}>
                  {gi > 0 && <div className="eyebrow py-1.5 text-center">or</div>}
                  <div className="space-y-1.5 rounded-lg border border-border bg-surface-2/40 p-2">
                    {g.map((c, ci) => (
                      <div key={ci} className="flex flex-wrap items-center gap-1.5">
                        <span className="w-9 text-right font-mono text-2xs text-muted">
                          {ci === 0 ? "IF" : "AND"}
                        </span>
                        <select
                          aria-label="Field"
                          value={c.field}
                          onChange={(e) =>
                            setCond(gi, ci, { field: e.target.value as RuleCondition["field"] })
                          }
                          className="input h-7 w-28 py-0 text-xs"
                        >
                          {RULE_FIELDS.map((f) => (
                            <option key={f} value={f}>
                              {RULE_FIELD_LABELS[f]}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Operator"
                          value={c.op}
                          onChange={(e) =>
                            setCond(gi, ci, { op: e.target.value as RuleCondition["op"] })
                          }
                          className="input h-7 w-36 py-0 text-xs"
                        >
                          {RULE_OPS.map((o) => (
                            <option key={o} value={o}>
                              {RULE_OP_LABELS[o]}
                            </option>
                          ))}
                        </select>
                        {c.field === "type" ? (
                          <select
                            aria-label="Value"
                            value={c.value}
                            onChange={(e) => setCond(gi, ci, { value: e.target.value })}
                            className="input h-7 min-w-24 flex-1 py-0 text-xs"
                          >
                            <option value="">Choose…</option>
                            {SAVE_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            aria-label="Value"
                            value={c.value}
                            onChange={(e) => setCond(gi, ci, { value: e.target.value })}
                            placeholder={
                              c.field === "tag"
                                ? "cybersecurity"
                                : c.field === "domain"
                                  ? "github.com"
                                  : "value"
                            }
                            list={c.field === "tag" ? "known-tags" : undefined}
                            className="input h-7 min-w-24 flex-1 py-0 text-xs"
                          />
                        )}
                        <button
                          type="button"
                          aria-label="Remove condition"
                          onClick={() =>
                            setGroups((gs) =>
                              gs
                                .map((x, i) => (i === gi ? x.filter((_, j) => j !== ci) : x))
                                .filter((x) => x.length),
                            )
                          }
                          className="p-1 text-muted hover:text-danger"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setGroups((gs) =>
                          gs.map((x, i) => (i === gi ? [...x, emptyCondition()] : x)),
                        )
                      }
                      className="ml-10 text-xs text-accent-ink hover:underline"
                    >
                      + and
                    </button>
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setGroups((gs) => [...gs, [emptyCondition()]])}
              >
                <Plus size={13} /> Add “or” group
              </Button>
              <datalist id="known-tags">
                {app.tags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>

              <div className="rounded-lg border border-border">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <span className="eyebrow flex-1">Preview</span>
                  {previewing ? (
                    <Loader2 size={12} className="animate-spin text-muted" />
                  ) : (
                    <span className="font-mono text-2xs text-fg-2">
                      {preview ? `${preview.count} matching` : "—"}
                    </span>
                  )}
                </div>
                <ul className="max-h-44 overflow-y-auto p-1">
                  {!preview?.sample.length && (
                    <li className="px-2 py-2 text-xs text-muted">
                      {validRules ? "Nothing matches yet." : "Add a rule to see matches."}
                    </li>
                  )}
                  {preview?.sample.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 px-2 py-1 text-xs">
                      <Favicon url={s.faviconUrl} domain={s.domain} size={12} />
                      <span className="truncate">{s.title}</span>
                      <span className="ml-auto shrink-0 font-mono text-2xs text-muted">
                        {s.domain}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || saving}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {editing ? "Save changes" : "Create"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
