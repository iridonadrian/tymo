"use client";

import { useState } from "react";
import { authorizeAction } from "@/server/actions";

export function ConsentForm({
  params,
  appName,
  redirectHost,
  wantsWrite,
}: {
  params: Record<string, string>;
  appName: string;
  redirectHost: string;
  wantsWrite: boolean;
}) {
  const [allowWrite, setAllowWrite] = useState(wantsWrite);
  const [busy, setBusy] = useState<null | "allow" | "deny">(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (approve: boolean) => {
    setBusy(approve ? "allow" : "deny");
    setError(null);
    const res = await authorizeAction(params, approve, allowWrite);
    if (!res.ok) {
      setBusy(null);
      return setError(res.error);
    }
    // A full navigation to the app's registered redirect URI (validated server-side).
    window.location.assign(res.data);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-base leading-snug font-semibold">
          Allow <span className="text-accent-ink">{appName}</span> to use your Tymo library?
        </h1>
        <p className="mt-1.5 text-sm text-fg-2">
          The name is chosen by the app itself. What identifies it is where you’ll be sent after you
          allow it: <span className="font-mono text-xs text-fg">{redirectHost}</span> (for
          claude.ai, that’s <span className="font-mono text-xs">claude.ai</span>). Only continue if
          you started this from that app.
        </p>
      </div>
      <ul className="space-y-1.5 rounded-lg border border-border bg-surface-2/40 p-3 text-sm text-fg-2">
        <li>✓ Search your saves and read their text, notes and highlights</li>
        <li>✓ See your collections and tags</li>
        {wantsWrite && (
          <li>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={allowWrite}
                onChange={(e) => setAllowWrite(e.target.checked)}
                className="mt-1 accent-accent"
              />
              <span>
                Also save links, notes and highlights, and organize saves (tags, collections,
                archive). It can never delete anything.
              </span>
            </label>
          </li>
        )}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => decide(false)}
          className="h-9 flex-1 rounded-lg border border-border text-sm font-medium text-fg-2 hover:border-border-strong hover:text-fg disabled:opacity-60"
        >
          {busy === "deny" ? "Cancelling…" : "Cancel"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => decide(true)}
          className="h-9 flex-1 rounded-lg bg-accent text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {busy === "allow" ? "Connecting…" : "Allow"}
        </button>
      </div>
      <p className="text-xs text-muted">
        You can disconnect it any time in Settings → Connected apps.
      </p>
    </div>
  );
}
