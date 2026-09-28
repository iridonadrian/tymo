"use client";

import { forwardRef, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn, relativeTime, fullDate } from "@/lib/format";
import { CodeField } from "./code-field";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
        variant === "primary" && "bg-accent text-on-accent shadow-button hover:bg-accent-hover",
        variant === "secondary" &&
          "border border-border bg-transparent text-fg-2 hover:border-border-strong hover:bg-surface-2 hover:text-fg",
        variant === "ghost" && "text-fg-2 hover:bg-surface-2 hover:text-fg",
        variant === "danger" &&
          "border border-danger-line bg-danger-soft text-danger hover:bg-danger-soft-hover",
        className,
      )}
      {...props}
    />
  );
});

export function IconButton({
  label,
  className,
  children,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg",
        active && "bg-surface-2 text-fg",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Tag({
  name,
  onRemove,
  className,
}: {
  name: string;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-40 items-center gap-1 rounded-full border border-border bg-surface-2 px-2 text-[11px] text-fg-2",
        className,
      )}
    >
      <span className="truncate">#{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${name}`}
          className="text-muted hover:text-fg"
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}

export function Time({ ts, className }: { ts: number; className?: string }) {
  return (
    <time
      dateTime={new Date(ts).toISOString()}
      title={fullDate(ts)}
      className={cn("font-mono text-2xs text-muted", className)}
      suppressHydrationWarning
    >
      {relativeTime(ts)}
    </time>
  );
}

/** Accessible modal built on <dialog>: focus trap, Esc to close, inert background. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={labelledBy ? undefined : title}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto mt-[12vh] w-[min(560px,calc(100vw-32px))] rounded-xl border border-border bg-surface p-0 text-fg shadow-elevated backdrop:bg-black/60 open:animate-pop",
        className,
      )}
    >
      {open && children}
    </dialog>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <div className="bg-blueprint pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative">
        {icon && (
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg border border-border bg-surface text-fg-2">
            {icon}
          </div>
        )}
        <h3 className="text-sm font-medium">{title}</h3>
        {children && <div className="mx-auto mt-1.5 max-w-md text-sm text-fg-2">{children}</div>}
      </div>
    </div>
  );
}

/** Hairline that fades out at both ends, so headers never read as a hard box. */
export function HeaderRule() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-border-strong to-transparent"
    />
  );
}

export function PageHeader({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="relative -mx-4 -mt-6 mb-7 overflow-hidden px-4 pt-7 pb-6 sm:-mx-6 sm:px-6 md:-mt-8 md:pt-10 lg:-mx-10 lg:px-10">
      <CodeField intensity={0.7} />
      <HeaderRule />
      <div className="relative flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
          <h1 className="truncate text-[28px] leading-tight font-medium tracking-tight">{title}</h1>
          {children && <div className="mt-1 text-sm text-fg-2">{children}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
