"use client";

import { useEffect, useRef, useState } from "react";
import { AlarmClock } from "lucide-react";
import { snoozePresets } from "@/lib/snooze";
import { cn } from "@/lib/format";

/** Button + popover with snooze presets. `placement` picks which way the menu opens. */
export function SnoozeMenu({
  label = "Snooze",
  onSnooze,
  children,
  placement = "down",
  className,
}: {
  label?: string;
  onSnooze: (until: number) => void;
  children: React.ReactNode;
  placement?: "up" | "down";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={className}
      >
        {children}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 z-50 w-52 rounded-lg border border-border-strong bg-surface-2 p-1 shadow-elevated",
            placement === "up" ? "bottom-9" : "top-9",
          )}
        >
          {snoozePresets().map((p) => (
            <button
              key={p.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSnooze(p.until);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3"
            >
              <AlarmClock size={13} className="text-muted" />
              <span className="flex-1">{p.label}</span>
              <span className="font-mono text-2xs text-muted">
                {new Date(p.until).toLocaleString("en-US", {
                  weekday: "short",
                  hour: "numeric",
                })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
