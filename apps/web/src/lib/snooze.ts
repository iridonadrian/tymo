/** Snooze presets, computed in the user's local time. Mornings mean 9:00. */
export function snoozePresets(now = new Date()): { label: string; until: number }[] {
  const at = (days: number, hour = 9) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };
  const dow = now.getDay(); // 0 = Sunday
  const toSaturday = (6 - dow + 7) % 7 || 7;
  const toMonday = (1 - dow + 7) % 7 || 7;
  const presets = [
    { label: "Later today", until: now.getTime() + 3 * 3600_000 },
    { label: "Tomorrow", until: at(1) },
    { label: "This weekend", until: at(toSaturday) },
    { label: "Next week", until: at(toMonday) },
    { label: "In a month", until: at(30) },
  ];
  // "Later today" makes no sense late in the evening; "This weekend" is pointless on Friday night.
  return presets.filter(
    (p, i) => !(i === 0 && now.getHours() >= 20) && !(i === 2 && toSaturday === 1),
  );
}

export function formatSnooze(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleString("en-US", {
    weekday: ts - now < 6 * 86_400_000 ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
