export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" style={{ fill: "var(--color-surface)" }} />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7.5"
        fill="none"
        style={{ stroke: "var(--color-border-strong)" }}
      />
      <path
        d="M9 10h14M16 10v13"
        strokeWidth="2.4"
        strokeLinecap="round"
        style={{ stroke: "var(--color-fg)" }}
      />
      <circle cx="23" cy="22" r="2.6" style={{ fill: "var(--color-accent)" }} />
    </svg>
  );
}
