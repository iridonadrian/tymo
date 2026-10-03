export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build")
    return;
  // `next start` outside Docker (the container entrypoint does its own, stricter check).
  const pw = process.env.TYMO_PASSWORD ?? "";
  if (pw && pw.length < 12)
    console.warn("[tymo] TYMO_PASSWORD is short; a 12+ character passphrase is recommended.");
  const { resumePendingEnrichment } = await import("./server/enrich");
  const { queueMissingEmbeddings } = await import("./server/embeddings");
  const { maybeScheduledBackup } = await import("./server/backup");
  const backup = () =>
    void maybeScheduledBackup().catch((err) =>
      console.warn(`[backup] ${err instanceof Error ? err.message : err}`),
    );
  const { maybeScheduledLinkCheck } = await import("./server/linkcheck");
  const linkCheck = () => void maybeScheduledLinkCheck().catch(() => {});
  setTimeout(backup, 60_000).unref?.();
  setInterval(backup, 3600_000).unref?.();
  setInterval(linkCheck, 3600_000).unref?.();
  // Picks up saves whose metadata fetch (or embedding) was interrupted by a restart.
  const { initSync } = await import("./server/sync");
  setTimeout(() => void initSync().catch((err) => console.warn(`[sync] ${err}`)), 1000).unref?.();
  setTimeout(() => {
    void resumePendingEnrichment().catch(() => {});
    void queueMissingEmbeddings().catch(() => {});
  }, 2000);
}
