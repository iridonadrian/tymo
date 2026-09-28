"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { History, Plus, Search, Upload } from "lucide-react";
import { useApp } from "./app-context";
import { Button } from "./ui";

export function DashboardSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      className="relative flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/saves?q=${encodeURIComponent(q.trim())}` : "/saves");
      }}
    >
      <Search
        size={15}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
      />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your memory…"
        aria-label="Search saves"
        className="input h-10 pl-9 text-[15px]"
      />
      <kbd className="kbd touch-hidden absolute top-1/2 right-3 -translate-y-1/2">⌘K</kbd>
    </form>
  );
}

export function DashboardActions() {
  const { openQuickSave, toast } = useApp();
  const router = useRouter();
  return (
    <div className="flex gap-2">
      <Button variant="primary" className="h-10 px-4" onClick={() => openQuickSave()}>
        <Plus size={15} /> Save
      </Button>
      <Button
        className="h-10"
        onClick={() =>
          toast("Open the Tymo browser extension and choose “Save session” — or press Alt+Shift+E.")
        }
      >
        <History size={15} /> Save Session
      </Button>
      <Button className="h-10" onClick={() => router.push("/settings#import")}>
        <Upload size={15} /> Import
      </Button>
    </div>
  );
}
