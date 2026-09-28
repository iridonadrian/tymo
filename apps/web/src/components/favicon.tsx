"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, StickyNote, FileType2 } from "lucide-react";
import { cn, imageSrc } from "@/lib/format";

const PALETTE = ["#6798ff", "#8b7cf6", "#4fb3a9", "#d98c5f", "#c86b8e", "#7aa35b"];

/** Favicon with a deterministic letter-tile fallback. Remote icons load via the image proxy. */
export function Favicon({
  url,
  domain,
  type,
  size = 16,
  className,
}: {
  url?: string | null;
  domain?: string | null;
  type?: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  const src = imageSrc(url);
  // An image that failed before hydration never fires onError for React; check on mount.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);
  const box = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[4px]",
    className,
  );
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={ref}
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn(box, "bg-surface-2 object-contain")}
        style={{ width: size, height: size }}
      />
    );
  }
  const Icon =
    type === "note" || type === "snippet"
      ? StickyNote
      : type === "pdf"
        ? FileType2
        : type === "image" || type === "screenshot"
          ? ImageIcon
          : null;
  if (Icon || !domain) {
    const I = Icon ?? FileText;
    return (
      <span
        className={cn(box, "bg-surface-2 text-fg-2")}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <I size={Math.round(size * 0.7)} />
      </span>
    );
  }
  const letter = domain.replace(/^www\./, "")[0]?.toUpperCase() ?? "?";
  const color = PALETTE[[...domain].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
  return (
    <span
      className={cn(box, "font-mono font-semibold text-black")}
      style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.6) }}
      aria-hidden
    >
      {letter}
    </span>
  );
}
