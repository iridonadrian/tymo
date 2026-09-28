/**
 * Imports from other read-later / bookmarking services: Pocket, Raindrop.io, Instapaper,
 * Pinboard, Tymo's own CSV, and any CSV with a URL column. Pure parsing — no network.
 */
import { MAX_IMPORT_ITEMS, type ImportedBookmark } from "./bookmarks";
import { isHttpUrl } from "./url";

export type ServiceItem = ImportedBookmark & { notes?: string; favorite?: boolean };
export type ServiceFormat = "pocket" | "raindrop" | "instapaper" | "pinboard" | "tymo-csv" | "csv";

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes, optional BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Seconds, milliseconds or ISO dates → unix ms (undefined when unparseable or absurd). */
export function parseWhen(raw: string | number | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  let ms: number;
  if (typeof raw === "number" || /^\d+(\.\d+)?$/.test(String(raw).trim())) {
    const n = Number(raw);
    ms = n > 1e11 ? n : n * 1000;
  } else ms = Date.parse(String(raw));
  return Number.isFinite(ms) && ms > 0 && ms < Date.UTC(2200, 0, 1) ? Math.round(ms) : undefined;
}

const clean = (v: string | undefined, max: number) => {
  const t = v?.trim();
  return t ? t.slice(0, max) : undefined;
};

function splitTags(raw: string | undefined, sep: RegExp): string[] {
  return (raw ?? "")
    .split(sep)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 50);
}

/** Collection path from a folder string; service "system" folders don't become collections. */
function folderPath(raw: string | undefined, ignore: string[]): string[] {
  const parts = (raw ?? "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 1 && ignore.includes(parts[0]!.toLowerCase())) return [];
  return parts.slice(0, 5);
}

export function detectCsvFormat(header: string[]): ServiceFormat | null {
  const h = new Set(header.map((c) => c.trim().toLowerCase()));
  if (h.has("time_added") && h.has("url")) return "pocket";
  if (h.has("url") && h.has("folder") && h.has("excerpt") && h.has("created")) return "raindrop";
  if (h.has("url") && h.has("selection") && h.has("folder")) return "instapaper";
  if (h.has("url") && h.has("collections") && h.has("created_at")) return "tymo-csv";
  if (["url", "link", "href", "address"].some((k) => h.has(k))) return "csv";
  return null;
}

/** Parses a CSV export from a supported service (or a generic CSV with a URL column). */
export function parseServiceCsv(text: string): {
  format: ServiceFormat;
  items: ServiceItem[];
  skipped: number;
} {
  const rows = parseCsv(text);
  const header = rows[0]?.map((c) => c.trim().toLowerCase()) ?? [];
  const format = detectCsvFormat(header);
  if (!format) throw new Error("This CSV has no URL column, so there is nothing to import.");
  const col = (row: string[], ...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0 && row[i] !== undefined) return row[i];
    }
    return undefined;
  };

  const items: ServiceItem[] = [];
  let skipped = 0;
  for (const row of rows.slice(1, MAX_IMPORT_ITEMS + 1)) {
    const url = col(row, "url", "link", "href", "address")?.trim() ?? "";
    if (!isHttpUrl(url)) {
      skipped++;
      continue;
    }
    let item: ServiceItem;
    switch (format) {
      case "pocket":
        item = {
          url,
          title: clean(col(row, "title"), 500) ?? "",
          tags: splitTags(col(row, "tags"), /[|,]/),
          folders: [],
          addDate: parseWhen(col(row, "time_added")),
        };
        break;
      case "raindrop":
        item = {
          url,
          title: clean(col(row, "title"), 500) ?? "",
          description: clean(col(row, "excerpt"), 5000),
          notes: clean(
            [col(row, "note"), col(row, "highlights")].filter(Boolean).join("\n\n"),
            50_000,
          ),
          tags: splitTags(col(row, "tags"), /,/),
          folders: folderPath(col(row, "folder"), ["unsorted"]),
          addDate: parseWhen(col(row, "created")),
          favorite: /^(true|1|yes)$/i.test(col(row, "favorite")?.trim() ?? ""),
        };
        break;
      case "instapaper": {
        const folder = col(row, "folder")?.trim() ?? "";
        item = {
          url,
          title: clean(col(row, "title"), 500) ?? "",
          notes: clean(col(row, "selection"), 50_000),
          tags: splitTags(col(row, "tags")?.replace(/^\[|\]$/g, ""), /,/),
          folders: folderPath(folder, ["unread", "archive", "starred"]),
          addDate: parseWhen(col(row, "timestamp")),
          favorite: folder.toLowerCase() === "starred",
        };
        break;
      }
      case "tymo-csv":
        item = {
          url,
          title: clean(col(row, "title"), 500) ?? "",
          description: clean(col(row, "description"), 5000),
          notes: clean(col(row, "notes"), 50_000),
          tags: splitTags(col(row, "tags"), /\s+/),
          folders: splitTags(col(row, "collections"), /\s\|\s/).slice(0, 1),
          addDate: parseWhen(col(row, "created_at")),
        };
        break;
      default:
        item = {
          url,
          title: clean(col(row, "title", "name"), 500) ?? "",
          description: clean(col(row, "description", "excerpt", "summary"), 5000),
          notes: clean(col(row, "notes", "note", "comment"), 50_000),
          tags: splitTags(col(row, "tags", "tag", "labels"), /[,|;]/),
          folders: folderPath(col(row, "folder", "collection", "category"), []),
          addDate: parseWhen(col(row, "created", "created_at", "date", "added", "time_added")),
        };
    }
    items.push(item);
  }
  return { format, items, skipped };
}

/** Pinboard JSON export (`/v1/posts/all?format=json` or the settings backup). */
export function parsePinboardJson(data: unknown): { items: ServiceItem[]; skipped: number } | null {
  if (!Array.isArray(data) || !data.length) return null;
  const first = data[0] as Record<string, unknown>;
  if (typeof first !== "object" || first === null || !("href" in first)) return null;
  const items: ServiceItem[] = [];
  let skipped = 0;
  for (const raw of data.slice(0, MAX_IMPORT_ITEMS) as Record<string, unknown>[]) {
    const url = typeof raw.href === "string" ? raw.href.trim() : "";
    if (!isHttpUrl(url)) {
      skipped++;
      continue;
    }
    items.push({
      url,
      title: clean(typeof raw.description === "string" ? raw.description : undefined, 500) ?? "",
      notes: clean(typeof raw.extended === "string" ? raw.extended : undefined, 50_000),
      tags: splitTags(typeof raw.tags === "string" ? raw.tags : "", /\s+/),
      folders: [],
      addDate: parseWhen(typeof raw.time === "string" ? raw.time : undefined),
    });
  }
  return { items, skipped };
}
