"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Pencil, Plus, Trash2 } from "lucide-react";
import type { CollectionView } from "@/server/collections";
import { deleteCollectionAction } from "@/server/actions";
import { useApp } from "./app-context";
import { CollectionDialog } from "./collection-dialog";
import { Button } from "./ui";

export function NewCollectionButtons() {
  const { openCollectionDialog } = useApp();
  return (
    <>
      <Button onClick={() => openCollectionDialog(true)}>
        <Layers size={14} /> Smart collection
      </Button>
      <Button variant="primary" onClick={() => openCollectionDialog()}>
        <Plus size={14} /> New collection
      </Button>
    </>
  );
}

export function CollectionHeaderActions({ collection }: { collection: CollectionView }) {
  const [editing, setEditing] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();
  const { toast } = useApp();
  return (
    <>
      <Button size="sm" onClick={() => setEditing(true)}>
        <Pencil size={13} /> Edit
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="hover:text-danger"
        onClick={() => {
          if (!confirm(`Delete “${collection.name}”? Saves in it are kept.`)) return;
          start(async () => {
            const res = await deleteCollectionAction(collection.id);
            if (!res.ok) return toast(res.error, { tone: "error" });
            toast("Collection deleted");
            router.push("/collections");
            router.refresh();
          });
        }}
      >
        <Trash2 size={13} /> Delete
      </Button>
      {editing && <CollectionDialog editing={collection} onClose={() => setEditing(false)} />}
    </>
  );
}
