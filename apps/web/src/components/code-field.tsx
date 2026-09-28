"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/format";

/**
 * Ambient "code field": a canvas of faint monospace glyphs that shimmer slowly and light up
 * (and scramble) around the pointer. Decorative only — aria-hidden, no pointer capture.
 *
 * Built to be cheap:
 *  - glyphs are pre-rendered once into an atlas (per theme colour) and blitted with
 *    drawImage + globalAlpha — no per-cell fillText or colour-string allocation;
 *  - 30 fps only while the pointer is near, ~12 fps for the idle shimmer;
 *  - paused off-screen, in background tabs, and a single static frame under reduced motion.
 *
 * Seamless look: colour blends continuously from the base grey to the accent (no threshold),
 * each cell has its own jittered radius so the lit area is organic rather than a block of
 * grid cells, and the edges fade out through a CSS mask.
 */
const GLYPHS = "01{}[]()<>/\\=+-*;:.,_#$%&|~^?!@abcdefxyz0123456789ABCDEF".split("");
const CELL_W = 12;
const CELL_H = 18;
const RADIUS = 160;
const ACTIVE_FPS = 30;
const IDLE_FPS = 12;

function tokenColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const MASKS = {
  /** Fades out left, right and bottom so the field melts into the page. */
  bottom: "code-field-mask",
  radial: "[mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]",
} as const;

export function CodeField({
  className,
  intensity = 1,
  mask = "bottom",
}: {
  className?: string;
  intensity?: number;
  mask?: keyof typeof MASKS;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !parent || !ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fontFamily = getComputedStyle(canvas).fontFamily || "monospace";
    let dpr = 1;
    let cols = 0;
    let rows = 0;
    let glyph = new Uint8Array(0);
    let base = new Float32Array(0);
    let phase = new Float32Array(0);
    let jitter = new Float32Array(0);
    let width = 0;
    let height = 0;
    let raf = 0;
    let last = 0;
    let visible = true;
    let rect = canvas.getBoundingClientRect();
    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, strength: 0, target: 0 };

    // Atlas: row 0 = base colour, row 1 = accent colour; one cell per glyph, at device pixels.
    const atlas = document.createElement("canvas");
    const actx = atlas.getContext("2d")!;
    const buildAtlas = () => {
      const cw = Math.ceil(CELL_W * dpr);
      const ch = Math.ceil(CELL_H * dpr);
      atlas.width = cw * GLYPHS.length;
      atlas.height = ch * 2;
      actx.clearRect(0, 0, atlas.width, atlas.height);
      actx.font = `${11 * dpr}px ${fontFamily}`;
      actx.textAlign = "center";
      actx.textBaseline = "middle";
      const colors = [tokenColor("--color-fg-2", "#a7a7a7"), tokenColor("--color-glow", "#6798ff")];
      colors.forEach((c, row) => {
        actx.fillStyle = c;
        GLYPHS.forEach((g, i) => actx.fillText(g, i * cw + cw / 2, row * ch + ch / 2));
      });
    };

    const layout = () => {
      rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(parent.clientWidth));
      height = Math.max(1, Math.floor(parent.clientHeight));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      cols = Math.ceil(width / CELL_W);
      rows = Math.ceil(height / CELL_H);
      const n = cols * rows;
      glyph = new Uint8Array(n);
      base = new Float32Array(n);
      phase = new Float32Array(n);
      jitter = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        glyph[i] = (Math.random() * GLYPHS.length) | 0;
        // Sparse field: most cells nearly invisible, a few a bit brighter.
        base[i] = Math.random() < 0.55 ? 0 : 0.035 + Math.random() ** 3 * 0.12;
        phase[i] = Math.random() * Math.PI * 2;
        jitter[i] = Math.random();
      }
      buildAtlas();
    };

    const draw = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pointer.x += (pointer.tx - pointer.x) * 0.2;
      pointer.y += (pointer.ty - pointer.y) * 0.2;
      pointer.strength += (pointer.target - pointer.strength) * 0.1;
      const time = t / 1000;
      const swellPos = ((time * 60) % (width + height + 400)) - 200;
      const cw = Math.ceil(CELL_W * dpr);
      const ch = Math.ceil(CELL_H * dpr);
      const lit = pointer.strength > 0.01;

      for (let r = 0; r < rows; r++) {
        const cy = r * CELL_H + CELL_H / 2;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const cx = c * CELL_W + CELL_W / 2;
          let boost = 0;
          if (lit) {
            const dx = cx - pointer.x;
            const dy = cy - pointer.y;
            // Per-cell radius jitter breaks up the grid so the glow has a soft, organic edge.
            const radius = RADIUS * (0.7 + 0.6 * jitter[i]!);
            const d2 = dx * dx + dy * dy;
            if (d2 < radius * radius) {
              const f = 1 - Math.sqrt(d2) / radius;
              boost = f * f * (3 - 2 * f) * pointer.strength;
              // Empty cells only partly light up: sparkle rather than a solid block.
              if (base[i] === 0) boost *= 0.35 + 0.65 * jitter[i]!;
            }
          }
          const swell =
            base[i]! > 0 ? Math.max(0, 1 - Math.abs(cx + cy - swellPos) / 160) * 0.05 : 0;
          const a =
            (base[i]! * (0.65 + 0.35 * Math.sin(time * 1.3 + phase[i]!)) + swell + boost * 0.85) *
            intensity;
          if (a < 0.012) continue;

          if (!reduced && (boost > 0.08 ? Math.random() < 0.25 * boost : Math.random() < 0.0015)) {
            glyph[i] = (Math.random() * GLYPHS.length) | 0;
          }
          // Continuous grey → accent blend: draw both atlas rows with complementary alpha.
          const mix = smooth(0.04, 0.55, boost);
          const alpha = Math.min(1, a);
          const sx = glyph[i]! * cw;
          const dx = Math.round(c * CELL_W * dpr);
          const dy = Math.round(r * CELL_H * dpr);
          if (mix < 0.999) {
            ctx.globalAlpha = alpha * (1 - mix);
            ctx.drawImage(atlas, sx, 0, cw, ch, dx, dy, cw, ch);
          }
          if (mix > 0.001) {
            ctx.globalAlpha = alpha * mix;
            ctx.drawImage(atlas, sx, ch, cw, ch, dx, dy, cw, ch);
          }
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      const active = pointer.strength > 0.01 || pointer.target > 0;
      if (t - last < 1000 / (active ? ACTIVE_FPS : IDLE_FPS)) return;
      last = t;
      draw(t);
    };

    const onMove = (e: PointerEvent) => {
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const inside = x >= -40 && y >= -40 && x <= rect.width + 40 && y <= rect.height + 40;
      pointer.tx = x;
      pointer.ty = y;
      if (pointer.x < -1000) {
        pointer.x = x;
        pointer.y = y;
      }
      pointer.target = inside && e.pointerType !== "touch" ? 1 : 0;
    };
    const onLeave = () => (pointer.target = 0);
    const onScroll = () => (rect = canvas.getBoundingClientRect());

    const readColors = () => {
      buildAtlas();
      if (reduced) draw(0);
    };
    const themeObserver = new MutationObserver(readColors);
    const schemeQuery = window.matchMedia("(prefers-color-scheme: light)");
    const ro = new ResizeObserver(() => {
      layout();
      if (reduced) draw(0);
    });
    const io = new IntersectionObserver(([entry]) => (visible = !!entry?.isIntersecting));

    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      layout();
      themeObserver.observe(document.documentElement, { attributeFilter: ["data-theme"] });
      schemeQuery.addEventListener("change", readColors);
      ro.observe(parent);
      io.observe(canvas);
      if (reduced) draw(0);
      else {
        raf = requestAnimationFrame(loop);
        window.addEventListener("pointermove", onMove, { passive: true });
        window.addEventListener("scroll", onScroll, { passive: true, capture: true });
        document.addEventListener("pointerleave", onLeave);
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
      schemeQuery.removeEventListener("change", readColors);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [intensity]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 font-mono", MASKS[mask], className)}
    />
  );
}
