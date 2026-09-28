"use client";

import type { SaveView } from "@/server/saves";
import { markOpenedAction } from "@/server/actions";
import { useApp } from "./app-context";
import { Favicon } from "./favicon";
import { openHref } from "./save-card";
import { Tag, Time } from "./ui";

/** Compact read-only list used on the dashboard. */
export function MiniSaveList({ saves, compact }: { saves: SaveView[]; compact?: boolean }) {
  const { openSave } = useApp();
  return (
    <ul className="divide-y divide-border/70 card overflow-hidden">
      {saves.map((s) => {
        const href = openHref(s);
        return (
          <li key={s.id} className="group flex items-center gap-3 px-3 py-2 hover:bg-surface-2/60">
            <Favicon url={s.faviconUrl} domain={s.domain} type={s.type} size={16} />
            <div className="min-w-0 flex-1">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => markOpenedAction(s.id)}
                  className="block truncate text-sm hover:underline"
                >
                  {s.title}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => openSave(s.id)}
                  className="block w-full truncate text-left text-sm"
                >
                  {s.title}
                </button>
              )}
              <span className="block truncate font-mono text-2xs text-muted">
                {s.domain ?? s.type}
              </span>
            </div>
            {!compact && (
              <span className="hidden gap-1 md:flex">
                {s.tags.slice(0, 2).map((t) => (
                  <Tag key={t} name={t} />
                ))}
              </span>
            )}
            <button
              type="button"
              onClick={() => openSave(s.id)}
              className="font-mono text-2xs text-muted opacity-0 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
            >
              EDIT
            </button>
            <Time
              ts={compact && s.lastOpenedAt ? s.lastOpenedAt : s.createdAt}
              className="w-7 text-right"
            />
          </li>
        );
      })}
    </ul>
  );
}
