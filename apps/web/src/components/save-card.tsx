"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Star, FileText, Check } from "lucide-react";
import { SAVE_TYPE_LABELS, formatPrice, safeHref } from "@tymo/core";
import type { SaveView } from "@/server/saves";
import { cn, imageSrc } from "@/lib/format";
import { reportColors } from "@/lib/colors-client";
import { Favicon } from "./favicon";
import { Tag, Time } from "./ui";

export type ViewMode = "grid" | "list" | "dense";

interface Props {
  save: SaveView;
  mode: ViewMode;
  selected: boolean;
  focused: boolean;
  tabbable: boolean;
  selectionActive: boolean;
  onSelect: (e: React.MouseEvent | React.KeyboardEvent) => void;
  onOpenDetail: () => void;
  onOpenLink: () => void;
  onToggleFavorite: () => void;
}

export function openHref(save: Pick<SaveView, "url" | "fileId">) {
  return safeHref(save.url) ?? (save.fileId ? `/files/${save.fileId}` : undefined);
}

function Checkbox({
  checked,
  onClick,
  visible,
  label,
}: {
  checked: boolean;
  onClick: (e: React.MouseEvent) => void;
  visible: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-opacity",
        checked ? "border-accent bg-accent text-on-accent" : "border-border-strong bg-surface",
        visible || checked
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
      )}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  );
}

function SaveCardImpl({
  save,
  mode,
  selected,
  focused,
  tabbable,
  selectionActive,
  onSelect,
  onOpenDetail,
  onOpenLink,
  onToggleFavorite,
}: Props) {
  const href = openHref(save);
  const thumbSrc =
    save.fileId && save.fileMime?.startsWith("image/")
      ? `/files/${save.fileId}`
      : imageSrc(save.imageUrl);
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbRef = useRef<HTMLImageElement>(null);
  // An image that failed before hydration never fires onError for React; check on mount.
  useEffect(() => {
    const img = thumbRef.current;
    if (img?.complete && img.naturalWidth === 0) setThumbFailed(true);
    else if (img?.complete && save.colors === null) reportColors(save.id, img);
  }, [thumbSrc, save.id, save.colors]);
  const thumb = thumbFailed ? undefined : thumbSrc;
  const collection = save.collections[0];
  const source = save.domain ?? SAVE_TYPE_LABELS[save.type];

  const title = href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.stopPropagation();
        if (selectionActive) {
          e.preventDefault();
          onSelect(e);
          return;
        }
        onOpenLink();
      }}
      className="truncate font-medium text-fg decoration-border-strong underline-offset-2 hover:underline"
    >
      {save.title}
    </a>
  ) : (
    <span className="truncate font-medium text-fg">{save.title}</span>
  );

  const broken =
    save.linkStatus === "broken" ? (
      <span
        title="This link looks dead (checked automatically)"
        className="shrink-0 rounded-sm border border-danger/50 px-1 font-mono text-[10px] text-danger"
      >
        BROKEN
      </span>
    ) : null;

  const similar = save.semantic ? (
    <span
      title="Matched by meaning (semantic search), not by keyword"
      className="shrink-0 rounded-sm border border-border px-1 font-mono text-[10px] text-muted"
    >
      ≈ SIMILAR
    </span>
  ) : null;

  const fav = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggleFavorite();
      }}
      aria-label={save.isFavorite ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={save.isFavorite}
      className={cn(
        "shrink-0 rounded p-0.5 transition-opacity",
        save.isFavorite
          ? "text-warn"
          : "text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-fg",
      )}
    >
      <Star size={13} fill={save.isFavorite ? "currentColor" : "none"} />
    </button>
  );

  const common = {
    "data-save-id": save.id,
    "aria-selected": selected,
    role: "option" as const,
    tabIndex: tabbable ? 0 : -1,
    onClick: (e: React.MouseEvent) =>
      selectionActive || e.shiftKey || e.metaKey || e.ctrlKey ? onSelect(e) : onOpenDetail(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && e.target === e.currentTarget) onOpenDetail();
    },
  };

  if (mode === "dense") {
    return (
      <div
        {...common}
        className={cn(
          "group flex h-9 cursor-default items-center gap-3 border-b border-border/60 px-3 text-sm outline-none",
          selected ? "bg-accent-soft" : "hover:bg-surface",
          focused && "ring-1 ring-accent ring-inset",
        )}
      >
        <Checkbox
          checked={selected}
          onClick={onSelect}
          visible={selectionActive}
          label={`Select ${save.title}`}
        />
        <Favicon url={save.faviconUrl} domain={save.domain} type={save.type} size={14} />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {title}
          {broken}
          {similar}
        </div>
        <span className="hidden w-40 truncate font-mono text-2xs text-muted lg:block">
          {source}
        </span>
        <div className="hidden w-48 justify-end gap-1 overflow-hidden xl:flex">
          {save.tags.slice(0, 2).map((t) => (
            <Tag key={t} name={t} />
          ))}
        </div>
        {fav}
        <Time ts={save.createdAt} className="w-8 text-right" />
      </div>
    );
  }

  if (mode === "list") {
    return (
      <div
        {...common}
        className={cn(
          "group flex cursor-default items-start gap-3 rounded-lg border px-3 py-2.5 outline-none transition-colors",
          selected
            ? "border-accent/50 bg-accent-soft"
            : "border-transparent hover:border-border hover:bg-surface",
          focused && "ring-1 ring-accent",
        )}
      >
        <div className="flex items-center gap-2 pt-0.5">
          <Checkbox
            checked={selected}
            onClick={onSelect}
            visible={selectionActive}
            label={`Select ${save.title}`}
          />
          <Favicon url={save.faviconUrl} domain={save.domain} type={save.type} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 text-sm">{title}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 font-mono text-2xs text-muted">
            <span className="truncate">{source}</span>
            {collection && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate text-fg-2">
                  {collection.icon ? `${collection.icon} ` : ""}
                  {collection.name}
                </span>
              </>
            )}
            {save.status === "inbox" && !save.snoozedUntil && (
              <span className="rounded-sm border border-accent/40 px-1 text-accent-ink">INBOX</span>
            )}
            {save.readMinutes && <span className="shrink-0">{save.readMinutes} MIN</span>}
            {save.snoozedUntil && (
              <span
                className="rounded-sm border border-border px-1 text-fg-2"
                title={`Back in the Inbox ${new Date(save.snoozedUntil).toLocaleString()}`}
              >
                SNOOZED
              </span>
            )}
            {broken}
            {similar}
          </div>
          {save.description && (
            <p className="mt-1 line-clamp-1 text-[13px] text-fg-2">{save.description}</p>
          )}
        </div>
        <div className="hidden max-w-[40%] flex-wrap justify-end gap-1 pt-0.5 sm:flex">
          {save.tags.slice(0, 4).map((t) => (
            <Tag key={t} name={t} />
          ))}
        </div>
        <div className="flex items-center gap-1.5 pt-0.5">
          {fav}
          <Time ts={save.createdAt} className="w-8 text-right" />
        </div>
      </div>
    );
  }

  const checkbox = (
    <Checkbox
      checked={selected}
      onClick={onSelect}
      visible={selectionActive}
      label={`Select ${save.title}`}
    />
  );
  const kind = cardKind(save, !!thumb);
  const img = thumb ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={thumbRef}
      src={thumb}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={cn(
        "w-full",
        kind === "image" ? "h-auto max-h-[560px] object-cover" : "size-full object-cover",
      )}
      onLoad={(e) => save.colors === null && reportColors(save.id, e.currentTarget)}
      onError={() => setThumbFailed(true)}
    />
  ) : null;
  const facts = save.facts;
  const text = save.description ?? save.excerpt;

  return (
    <div
      {...common}
      className={cn(
        "group relative flex cursor-default flex-col overflow-hidden rounded-xl border bg-surface shadow-[inset_0_1px_0_0_var(--color-card-highlight)] outline-none transition-colors",
        selected ? "border-accent/60 bg-accent-soft" : "border-border hover:border-border-strong",
        focused && "ring-1 ring-accent",
      )}
    >
      {kind === "quote" || kind === "text" ? (
        <div className="flex items-center justify-between px-3 pt-3">
          {checkbox}
          <span className="font-mono text-[10px] tracking-wide text-muted uppercase">
            {SAVE_TYPE_LABELS[save.type]}
          </span>
        </div>
      ) : (
        <div
          className={cn(
            "relative w-full overflow-hidden bg-surface-2",
            kind !== "image" && "border-b border-border",
            kind === "cover" && "aspect-[2/3]",
            kind === "product" && "aspect-square",
            kind === "recipe" && "aspect-[4/3]",
            kind === "page" && "aspect-[1.91/1]",
          )}
        >
          {img ?? (
            <div className="bg-blueprint flex size-full items-center justify-center">
              <Favicon url={save.faviconUrl} domain={save.domain} type={save.type} size={28} />
            </div>
          )}
          <div className="absolute top-2 left-2">{checkbox}</div>
          {kind === "product" && facts?.price !== undefined && (
            <span className="absolute top-2 right-2 rounded-md bg-bg/85 px-2 py-0.5 text-xs font-medium text-fg backdrop-blur">
              {formatPrice(facts.price, facts.currency)}
            </span>
          )}
          {save.type !== "link" && kind !== "image" && kind !== "product" && (
            <span className="absolute right-2 bottom-2 rounded-sm border border-border bg-bg/80 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-fg-2 uppercase backdrop-blur">
              {SAVE_TYPE_LABELS[save.type]}
            </span>
          )}
        </div>
      )}

      <div className={cn("flex flex-1 flex-col gap-1", kind === "image" ? "px-3 py-2" : "p-3")}>
        {kind === "quote" ? (
          <blockquote
            className={cn(
              "line-clamp-[9] text-fg",
              save.type === "snippet"
                ? "font-mono text-xs leading-relaxed whitespace-pre-wrap"
                : "font-serif text-[15px] leading-relaxed",
            )}
          >
            {save.type === "snippet" ? text : `“${text}”`}
          </blockquote>
        ) : (
          <div className="flex min-w-0 items-start gap-2 text-sm leading-snug">
            <div
              className={cn(
                "min-w-0 flex-1 [&>a]:whitespace-normal [&>span]:whitespace-normal",
                kind === "image" ? "line-clamp-1 text-xs" : "line-clamp-2",
              )}
            >
              {title}
            </div>
            {fav}
          </div>
        )}
        <FactsLine save={save} />
        {kind !== "image" && kind !== "quote" && text && (
          <p
            className={cn(
              "text-xs text-fg-2",
              kind === "text" ? "line-clamp-6" : kind === "page" ? "line-clamp-2" : "line-clamp-1",
            )}
          >
            {text}
          </p>
        )}
        {kind !== "image" && save.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1.5">
            {save.tags.slice(0, 3).map((t) => (
              <Tag key={t} name={t} />
            ))}
          </div>
        )}
        <div className="mt-auto flex items-center gap-1.5 pt-1 font-mono text-2xs text-muted">
          <Favicon url={save.faviconUrl} domain={save.domain} type={save.type} size={12} />
          <span className="truncate">{kind === "quote" && save.url ? `— ${source}` : source}</span>
          {kind !== "image" && collection && (
            <span className="truncate text-fg-2">· {collection.name}</span>
          )}
          {save.fileId && !thumb && <FileText size={11} />}
          {save.readMinutes && <span className="shrink-0">· {save.readMinutes} min</span>}
          {broken}
          {similar}
          {kind === "quote" && fav}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {save.colors && save.colors.length > 0 && (
              <span className="flex -space-x-0.5" aria-label="Main colours">
                {save.colors.slice(0, 4).map((c) => (
                  <span
                    key={c}
                    title={c}
                    className="size-2.5 rounded-full ring-1 ring-surface"
                    // Validated #rrggbb from the database; the palette is the point here.
                    style={{ backgroundColor: c }}
                  />
                ))}
              </span>
            )}
            <Time ts={save.createdAt} />
          </span>
        </div>
      </div>
    </div>
  );
}

type CardKind = "image" | "quote" | "text" | "cover" | "product" | "recipe" | "page";

/** Which grid card layout fits a save (mymind-style: the content decides the shape). */
function cardKind(save: SaveView, hasThumb: boolean): CardKind {
  const t = save.type;
  if ((t === "quote" || t === "snippet") && !hasThumb) return "quote";
  if (!hasThumb && (t === "note" || t === "quote" || t === "snippet")) return "text";
  if (t === "image" || t === "screenshot") return hasThumb ? "image" : "page";
  if ((t === "book" || t === "movie") && hasThumb) return "cover";
  if (t === "product" || save.facts?.kind === "product") return "product";
  if (t === "recipe") return "recipe";
  return "page";
}

/** One muted line of type-specific details: "35 min · 9 ingredients · ★ 4.6". */
export function FactsLine({ save }: { save: Pick<SaveView, "facts" | "type"> }) {
  const f = save.facts;
  if (!f) return null;
  const parts: string[] = [];
  if (f.kind === "recipe") {
    if (f.minutes) parts.push(formatMinutes(f.minutes));
    if (f.ingredients) parts.push(`${f.ingredients} ingredients`);
  } else if (f.kind === "product") {
    if (f.brand) parts.push(f.brand);
    if (f.price !== undefined && save.type !== "product")
      parts.push(formatPrice(f.price, f.currency));
    if (f.inStock === false) parts.push("out of stock");
  } else if (f.kind === "book") {
    if (f.author) parts.push(f.author);
    if (f.year) parts.push(String(f.year));
  } else if (f.kind === "movie") {
    if (f.year) parts.push(String(f.year));
    if (f.director) parts.push(f.director);
    else if (f.genre) parts.push(f.genre);
  } else if (f.kind === "place" && f.address) parts.push(f.address);
  if (f.rating) parts.push(`★ ${f.rating.toFixed(1)}`);
  if (!parts.length) return null;
  return <p className="truncate text-xs text-fg-2">{parts.join(" · ")}</p>;
}

function formatMinutes(m: number) {
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

export const SaveCard = memo(SaveCardImpl);
