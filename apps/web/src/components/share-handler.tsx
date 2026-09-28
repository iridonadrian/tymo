"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Share2 } from "lucide-react";
import { useApp } from "./app-context";
import { EmptyState } from "./ui";
import { sharePrefill } from "@/lib/share";

export function ShareHandler(props: {
  title?: string;
  text?: string;
  url?: string;
  popup?: boolean;
}) {
  const { openQuickSave, quickSave } = useApp();
  const router = useRouter();
  const opened = useRef(false);
  const seenOpen = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    openQuickSave(sharePrefill(props) || undefined);
  }, [openQuickSave, props]);

  // Once the dialog closes (saved or cancelled), land in the inbox.
  useEffect(() => {
    if (quickSave.open) seenOpen.current = true;
    else if (seenOpen.current) {
      // Opened by the bookmarklet in a small window: close it when done.
      if (props.popup) window.close();
      router.replace("/inbox");
    }
  }, [quickSave.open, router, props.popup]);

  return (
    <EmptyState icon={<Share2 size={18} />} title="Save to Tymo">
      Review the shared item and press Save.
    </EmptyState>
  );
}
