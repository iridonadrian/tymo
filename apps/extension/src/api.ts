/** Shared client for the Tymo server API. Works in background, popup and options pages. */

export const ext: typeof chrome =
  (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome;

export interface Config {
  serverUrl: string;
  token: string;
  defaultCollectionId?: string;
}

export async function getConfig(): Promise<Config | null> {
  const c = (await ext.storage.local.get([
    "serverUrl",
    "token",
    "defaultCollectionId",
  ])) as Partial<Config>;
  return c.serverUrl && c.token ? (c as Config) : null;
}

export async function setConfig(c: Partial<Config>) {
  await ext.storage.local.set(c);
}

export function normalizeServerUrl(raw: string): string {
  const u = new URL(raw.trim());
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new Error("Server URL must be http(s)");
  return u.origin;
}

export function isLocalOrigin(origin: string) {
  const h = new URL(origin).hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; config?: Config } = {},
): Promise<T> {
  const config = init.config ?? (await getConfig());
  if (!config) throw new ApiError(0, "Not connected. Open Tymo extension settings.");
  let res: Response;
  try {
    res = await fetch(config.serverUrl + path, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: {
        authorization: `Bearer ${config.token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      credentials: "omit",
    });
  } catch {
    throw new ApiError(0, `Can't reach Tymo at ${config.serverUrl}. Is it running?`);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const isSavableUrl = (url?: string) => !!url && /^https?:\/\//i.test(url);

export interface TabPayload {
  url: string;
  title?: string;
  faviconUrl?: string;
  windowIndex: number;
  index: number;
  pinned: boolean;
  groupTitle?: string;
  groupColor?: string;
}

/** Collects tabs (current window or all) with window order and tab-group info. */
export async function collectTabs(
  scope: "window" | "all",
): Promise<{ payload: TabPayload[]; tabIds: number[]; skipped: number }> {
  const tabs = await ext.tabs.query(scope === "window" ? { currentWindow: true } : {});
  const windowOrder = [...new Set(tabs.map((t) => t.windowId))];
  const groups = new Map<number, { title?: string; color?: string }>();
  const tg = (ext as unknown as { tabGroups?: typeof chrome.tabGroups }).tabGroups;
  if (tg) {
    for (const id of new Set(
      tabs.map((t) => t.groupId).filter((g): g is number => typeof g === "number" && g >= 0),
    )) {
      try {
        const g = await tg.get(id);
        groups.set(id, { title: g.title, color: g.color });
      } catch {
        /* group vanished */
      }
    }
  }
  const payload: TabPayload[] = [];
  const tabIds: number[] = [];
  let skipped = 0;
  for (const t of tabs) {
    if (!isSavableUrl(t.url)) {
      skipped++;
      continue;
    }
    const g = t.groupId !== undefined && t.groupId >= 0 ? groups.get(t.groupId) : undefined;
    payload.push({
      url: t.url!,
      title: t.title,
      faviconUrl: isSavableUrl(t.favIconUrl) ? t.favIconUrl : undefined,
      windowIndex: windowOrder.indexOf(t.windowId),
      index: t.index,
      pinned: !!t.pinned,
      groupTitle: g ? g.title || "Group" : undefined,
      groupColor: g?.color,
    });
    if (t.id !== undefined) tabIds.push(t.id);
  }
  return { payload, tabIds, skipped };
}

export function defaultSessionName(d = new Date()) {
  return `Session — ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export async function saveSession(scope: "window" | "all", name?: string, tags?: string[]) {
  const { payload, tabIds, skipped } = await collectTabs(scope);
  if (!payload.length) throw new Error("No web pages to save in this window.");
  const res = await api<{ id: string; saved: number; skipped: number }>("/api/v1/sessions", {
    body: { name: name?.trim() || defaultSessionName(), browser: __TARGET__, tags, tabs: payload },
  });
  return { ...res, skipped: res.skipped + skipped, tabIds };
}

/** Every web tab → the Bookmarks page (tab groups become folders), instead of a session. */
export async function saveTabsAsBookmarks(scope: "window" | "all") {
  const { payload, tabIds, skipped } = await collectTabs(scope);
  if (!payload.length) throw new Error("No web pages to bookmark in this window.");
  const res = await api<{ added: number; existing: number }>("/api/v1/bookmarks", {
    body: {
      links: payload.map((t) => ({
        url: t.url,
        title: t.title?.slice(0, 500) || undefined,
        folder: t.groupTitle?.slice(0, 80) || undefined,
      })),
    },
  });
  return { ...res, skipped, tabIds };
}

/** Recreates windows, tab order, pinned state and (where supported) tab groups. */
export async function restoreSession(id: string) {
  const s = await api<{
    id: string;
    name: string;
    tabs: {
      url: string;
      title: string;
      windowIndex: number;
      pinned: boolean;
      groupTitle: string | null;
      groupColor: string | null;
    }[];
  }>(`/api/v1/sessions/${encodeURIComponent(id)}`);
  const byWindow = new Map<number, typeof s.tabs>();
  for (const t of s.tabs) {
    if (!isSavableUrl(t.url)) continue;
    if (!byWindow.has(t.windowIndex)) byWindow.set(t.windowIndex, []);
    byWindow.get(t.windowIndex)!.push(t);
  }
  const tabsApi = ext.tabs as typeof chrome.tabs & { group?: typeof chrome.tabs.group };
  const tg = (ext as unknown as { tabGroups?: typeof chrome.tabGroups }).tabGroups;
  for (const tabs of byWindow.values()) {
    const win = await ext.windows.create({ url: tabs.map((t) => t.url), focused: true });
    const created = win?.tabs ?? (await ext.tabs.query({ windowId: win!.id }));
    const groups = new Map<string, { ids: number[]; color: string | null }>();
    for (let i = 0; i < tabs.length; i++) {
      const tab = created[i];
      if (!tab?.id) continue;
      if (tabs[i]!.pinned) await ext.tabs.update(tab.id, { pinned: true });
      const gt = tabs[i]!.groupTitle;
      if (gt) {
        const key = `${gt}|${tabs[i]!.groupColor}`;
        if (!groups.has(key)) groups.set(key, { ids: [], color: tabs[i]!.groupColor });
        groups.get(key)!.ids.push(tab.id);
      }
    }
    if (tabsApi.group && tg) {
      for (const [key, g] of groups) {
        try {
          const groupId = await tabsApi.group({
            tabIds: g.ids as [number, ...number[]],
            createProperties: { windowId: win!.id },
          });
          await tg.update(groupId, {
            title: key.split("|")[0],
            ...(g.color ? { color: g.color as chrome.tabGroups.Color } : {}),
          });
        } catch {
          /* grouping is best-effort */
        }
      }
    }
  }
  await api(`/api/v1/sessions/${encodeURIComponent(id)}`, {
    method: "POST",
    body: { restored: true },
  }).catch(() => {});
  return s;
}
