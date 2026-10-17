"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { bulkAction } from "@/server/actions";
import { useApp } from "./app-context";

/**
 * Delete without an "Are you sure?" dialog: items disappear at once and a toast offers
 * Undo for a few seconds; only then are they deleted for good. Pending ids stay hidden
 * in every list even if the page refreshes in the meantime.
 */
const UNDO_MS = 6000;
const pending = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();
const emit = () => {
  snapshot = new Set(pending);
  for (const l of listeners) l();
};

/** True while a delete for this save is waiting out its Undo window. */
export const isPendingDelete = (id: string) => pending.has(id);

export function usePendingDeletes(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => snapshot,
  );
}

export function useUndoableDelete() {
  const { toast } = useApp();
  const router = useRouter();
  return useCallback(
    (ids: string[], what: string) => {
      if (!ids.length) return;
      for (const id of ids) pending.add(id);
      emit();
      let undone = false;
      const timer = setTimeout(async () => {
        if (undone) return;
        const res = await bulkAction(ids, { kind: "delete" });
        for (const id of ids) pending.delete(id);
        emit();
        if (!res.ok) toast(res.error, { tone: "error" });
        router.refresh();
      }, UNDO_MS);
      toast(`Deleted ${what}`, {
        action: {
          label: "Undo",
          onClick: () => {
            undone = true;
            clearTimeout(timer);
            for (const id of ids) pending.delete(id);
            emit();
            toast("Restored", { tone: "success" });
            router.refresh();
          },
        },
      });
    },
    [router, toast],
  );
}
