/** Picks what to prefill from a share: Android often puts the link inside `text`. */
export function sharePrefill(p: { title?: string; text?: string; url?: string }): string {
  const url = p.url?.trim() || p.text?.match(/https?:\/\/[^\s<>"']+/)?.[0];
  if (url) return url;
  return [p.title?.trim(), p.text?.trim()].filter(Boolean).join("\n");
}
