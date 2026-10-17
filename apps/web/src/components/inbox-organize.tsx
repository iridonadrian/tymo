"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useApp } from "./app-context";
import { OrganizeDialog } from "./organize-dialog";
import { Button } from "./ui";

/** Inbox → one button: the AI files every item into a collection, you review, Apply. */
export function InboxOrganizeButton() {
  const { aiEnabled } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Sparkles size={13} /> Organize with AI
      </Button>
      <OrganizeDialog
        open={open}
        onClose={() => setOpen(false)}
        aiEnabled={aiEnabled}
        scope="inbox"
      />
    </>
  );
}
