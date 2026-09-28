"use client";

import { paletteFromPixels, type PaletteColor } from "@tymo/core";
import { setColorsAction } from "@/server/actions";

const SIZE = 40;
let canvas: HTMLCanvasElement | null = null;

/**
 * Dominant colours of an image the browser has already decoded. Only same-origin images
 * (the /img proxy and /files) can be read back from a canvas, which is exactly what cards use.
 */
export function measureColors(img: HTMLImageElement): PaletteColor[] | null {
  if (!img.complete || !img.naturalWidth) return null;
  try {
    canvas ??= document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    return paletteFromPixels(ctx.getImageData(0, 0, SIZE, SIZE).data, { max: 5 });
  } catch {
    return null; // tainted canvas or decode error: just skip colour search for this one
  }
}

const pending = new Map<string, PaletteColor[]>();
const sent = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Measures once per save per page load and sends results in small batches. */
export function reportColors(saveId: string, img: HTMLImageElement) {
  if (sent.has(saveId)) return;
  const colors = measureColors(img);
  if (!colors) return;
  sent.add(saveId);
  pending.set(saveId, colors);
  timer ??= setTimeout(flush, 800);
}

function flush() {
  timer = null;
  const items = [...pending].slice(0, 100).map(([id, colors]) => ({ id, colors }));
  for (const { id } of items) pending.delete(id);
  if (items.length) void setColorsAction(items);
  if (pending.size) timer = setTimeout(flush, 800);
}
