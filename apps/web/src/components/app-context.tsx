"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { CollectionView } from "@/server/collections";

export interface ToastItem {
  id: number;
  message: string;
  tone?: "default" | "error" | "success";
  action?: { label: string; onClick: () => void };
}

interface AppState {
  collections: CollectionView[];
  tags: string[];
  aiEnabled: boolean;
  quickSave: { open: boolean; prefill?: string };
  openQuickSave: (prefill?: string) => void;
  closeQuickSave: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  detailId: string | null;
  openSave: (id: string | null) => void;
  toasts: ToastItem[];
  toast: (message: string, opts?: Omit<ToastItem, "id" | "message">) => void;
  dismissToast: (id: number) => void;
  collectionDialog: { open: boolean; smart?: boolean };
  openCollectionDialog: (smart?: boolean) => void;
  closeCollectionDialog: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({
  collections,
  tags,
  aiEnabled,
  children,
}: {
  collections: CollectionView[];
  tags: string[];
  aiEnabled: boolean;
  children: React.ReactNode;
}) {
  const [quickSave, setQuickSave] = useState<{ open: boolean; prefill?: string }>({ open: false });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [collectionDialog, setCollectionDialog] = useState<{ open: boolean; smart?: boolean }>({
    open: false,
  });
  const seq = useRef(0);

  const dismissToast = useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    [],
  );
  const toast = useCallback(
    (message: string, opts?: Omit<ToastItem, "id" | "message">) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-3), { id, message, ...opts }]);
      setTimeout(() => dismissToast(id), opts?.action ? 6000 : 3500);
    },
    [dismissToast],
  );

  const value = useMemo<AppState>(
    () => ({
      collections,
      tags,
      aiEnabled,
      quickSave,
      openQuickSave: (prefill?: string) => setQuickSave({ open: true, prefill }),
      closeQuickSave: () => setQuickSave({ open: false }),
      paletteOpen,
      setPaletteOpen,
      detailId,
      openSave: setDetailId,
      toasts,
      toast,
      dismissToast,
      collectionDialog,
      openCollectionDialog: (smart?: boolean) => setCollectionDialog({ open: true, smart }),
      closeCollectionDialog: () => setCollectionDialog({ open: false }),
    }),
    [
      collections,
      tags,
      aiEnabled,
      quickSave,
      paletteOpen,
      detailId,
      toasts,
      toast,
      dismissToast,
      collectionDialog,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
