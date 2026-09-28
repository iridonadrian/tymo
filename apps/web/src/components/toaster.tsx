"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/format";
import { useApp } from "./app-context";

export function Toaster() {
  const { toasts, dismissToast } = useApp();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex animate-pop items-center gap-3 rounded-lg border bg-surface-2 px-3 py-2.5 text-sm shadow-elevated",
            t.tone === "error" ? "border-danger-line text-danger" : "border-border-strong",
          )}
        >
          {t.tone === "success" && (
            <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
          )}
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="font-medium text-accent-ink hover:underline"
              onClick={() => {
                t.action!.onClick();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
            className="text-muted hover:text-fg"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
