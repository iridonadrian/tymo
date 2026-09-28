/** Tiny in-memory token bucket. Single-process by design (see THREAT_MODEL.md). */
const buckets = new Map<string, { tokens: number; updated: number }>();

export function rateLimit(key: string, perMinute: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, updated: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.updated) / 60_000) * perMinute);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now - v.updated > 600_000) buckets.delete(k);
  }
  return true;
}
