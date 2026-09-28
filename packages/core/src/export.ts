import type { ExportableSave } from "./bookmarks";

/**
 * CSV cell escaping, including spreadsheet formula-injection protection:
 * cells starting with = + - @ tab or CR are prefixed with a single quote.
 */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(saves: ExportableSave[]): string {
  const header = [
    "title",
    "url",
    "type",
    "domain",
    "description",
    "tags",
    "collections",
    "notes",
    "created_at",
  ];
  const rows = saves.map((s) =>
    [
      s.title,
      s.url ?? "",
      s.type ?? "",
      s.domain ?? "",
      s.description ?? "",
      s.tags.join(" "),
      s.collections.join(" | "),
      s.notes ?? "",
      new Date(s.createdAt).toISOString(),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\r\n") + "\r\n";
}

function mdEscape(s: string): string {
  return s.replace(/([\\`*_[\]<>|])/g, "\\$1");
}

export function toMarkdown(saves: ExportableSave[]): string {
  const groups = new Map<string, ExportableSave[]>();
  for (const s of saves) {
    const key = s.collections[0] ?? "Uncategorized";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  let out = `# Tymo export\n\n_Exported ${new Date().toISOString()}_\n`;
  for (const [name, list] of groups) {
    out += `\n## ${mdEscape(name)}\n\n`;
    for (const s of list) {
      const title = mdEscape(s.title);
      const url = s.url
        ? s.url.replace(
            /[()\s<>]/g,
            (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"),
          )
        : null;
      out += url ? `- [${title}](${url})` : `- ${title}`;
      if (s.tags.length) out += " " + s.tags.map((t) => `\`#${t}\``).join(" ");
      out += "\n";
      if (s.description) out += `  > ${mdEscape(s.description).replace(/\n/g, " ")}\n`;
      if (s.notes) out += `  > ${mdEscape(s.notes).replace(/\n/g, "\n  > ")}\n`;
    }
  }
  return out;
}
