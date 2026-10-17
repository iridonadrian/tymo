import {
  api,
  collectTabs,
  defaultSessionName,
  ext,
  getConfig,
  isSavableUrl,
  restoreSession,
  saveSession,
  type Config,
  saveTabsAsBookmarks,
} from "./api";
import { hydrateIcons, icon } from "./icons";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const splitTags = (v: string) =>
  v
    .split(/[,\s]+/)
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);

function status(el: HTMLElement, text: string, kind: "ok" | "err") {
  el.textContent = text;
  el.className = `status ${kind}`;
}

let config: Config;

function showError(list: HTMLElement, err: unknown) {
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = (err as Error).message;
  list.replaceChildren(p);
}
let currentTab: chrome.tabs.Tab | undefined;
/** What was just saved from the tabs panel, and where Tymo shows it. */
let lastSession: { path: string; tabIds: number[] } | null = null;

/** A pressed/unpressed chip button; returns a getter. */
function chip(id: string, initial = false, onChange?: (on: boolean) => void) {
  const el = $(id);
  const set = (on: boolean) => el.setAttribute("aria-pressed", String(on));
  set(initial);
  el.onclick = () => {
    const on = el.getAttribute("aria-pressed") !== "true";
    set(on);
    onChange?.(on);
  };
  return { get: () => el.getAttribute("aria-pressed") === "true", set };
}
let favoriteChip: ReturnType<typeof chip>;
let knownSave = false;
let bookmarkChip: ReturnType<typeof chip>;
let archiveChip: ReturnType<typeof chip>;

/** Favicon, or the site's first letter when there is none. */
function faviconEl(url: string | null | undefined, label: string) {
  if (isSavableUrl(url ?? undefined)) {
    const img = document.createElement("img");
    img.src = url!;
    img.alt = "";
    img.onerror = () => img.replaceWith(faviconEl(null, label));
    return img;
  }
  const span = document.createElement("span");
  span.className = "fav-fallback";
  span.textContent = (label.replace(/^www\./, "")[0] ?? "·").toUpperCase();
  return span;
}

async function init() {
  hydrateIcons();
  const c = await getConfig();
  $("open-options").onclick = () => ext.runtime.openOptionsPage();
  $("configure").onclick = () => ext.runtime.openOptionsPage();
  if (!c) {
    $("not-configured").classList.remove("hidden");
    return;
  }
  config = c;
  $("app").classList.remove("hidden");
  $("open-app").onclick = () => ext.tabs.create({ url: config.serverUrl });

  // Tabs
  const tabs = ["save", "tabs", "find"] as const;
  const show = (t: (typeof tabs)[number]) => {
    for (const o of tabs) {
      $(`tab-${o}`).setAttribute("aria-selected", String(o === t));
      $(`panel-${o}`).classList.toggle("hidden", o !== t);
    }
    if (t === "tabs") void loadSessions();
    if (t === "find") {
      $<HTMLInputElement>("find-q").focus();
      if (!$<HTMLInputElement>("find-q").value) void showBookmarks();
    }
    void ext.storage.local.set({ lastTab: t });
  };
  for (const t of tabs) $(`tab-${t}`).onclick = () => show(t);

  // Find panel: debounced search over the whole library.
  let findTimer: ReturnType<typeof setTimeout> | undefined;
  const findInput = $<HTMLInputElement>("find-q");
  findInput.oninput = () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(
      () => void (findInput.value.trim() ? runFind(findInput.value) : showBookmarks()),
      220,
    );
  };
  findInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("find-results").querySelector<HTMLButtonElement>("button.item")?.click();
    }
  };

  // Save panel
  [currentTab] = await ext.tabs.query({ active: true, currentWindow: true });
  const title = $<HTMLInputElement>("title");
  title.value = currentTab?.title ?? "";
  $("url").textContent = currentTab?.url ?? "";
  let site = "";
  try {
    site = new URL(currentTab?.url ?? "").hostname;
  } catch {
    /* not a web page */
  }
  $("fav").replaceWith(faviconEl(currentTab?.favIconUrl, site || title.value));
  if (!isSavableUrl(currentTab?.url)) {
    status(
      $("save-status"),
      "This page can't be saved (only web pages). The Tabs tab saves every open tab.",
      "err",
    );
    $<HTMLButtonElement>("save").disabled = true;
    $<HTMLButtonElement>("save-close").disabled = true;
  }
  title.focus();
  title.select();

  const form = $<HTMLFormElement>("panel-save");
  form.onsubmit = (e) => {
    e.preventDefault();
    void saveCurrent();
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const active = tabs.find((t) => $(`tab-${t}`).getAttribute("aria-selected") === "true");
      if (active === "save") void saveCurrent();
      if (active === "tabs") $<HTMLFormElement>("panel-tabs").requestSubmit();
    }
  });
  $("screenshot").onclick = () => void takeScreenshot();
  $("save-close").onclick = () => void saveCurrent({ closeTab: true });
  const prefs = (await ext.storage.local.get(["archiveOnSave", "bookmarkOnSave", "lastTab"])) as {
    archiveOnSave?: boolean;
    bookmarkOnSave?: boolean;
    lastTab?: string;
  };
  favoriteChip = chip("as-favorite");
  bookmarkChip = chip("as-bookmark", !!prefs.bookmarkOnSave, (on) =>
    ext.storage.local.set({ bookmarkOnSave: on }),
  );
  archiveChip = chip("archive-copy", !!prefs.archiveOnSave, (on) =>
    ext.storage.local.set({ archiveOnSave: on }),
  );
  // Reopen on the tab used last time (Save for normal pages).
  if (prefs.lastTab === "tabs" || prefs.lastTab === "find") show(prefs.lastTab);
  void lookupPage();

  // Tabs panel
  $<HTMLInputElement>("session-name").value = defaultSessionName();
  const updateCount = async () => {
    const { payload, skipped } = await collectTabs(
      $<HTMLInputElement>("all-windows").checked ? "all" : "window",
    );
    $("tab-count").textContent = String(payload.length);
    $("tab-count-label").textContent =
      `${payload.length === 1 ? "tab" : "tabs"} ${$<HTMLInputElement>("all-windows").checked ? "in all windows" : "in this window"}${skipped ? ` · ${skipped} skipped` : ""}`;
    await findDuplicates();
  };
  $("all-windows").onchange = () => void updateCount();
  void updateCount();
  $("close-dupes").onclick = () => void closeDuplicates().then(updateCount);
  $<HTMLFormElement>("panel-tabs").onsubmit = (e) => {
    e.preventDefault();
    void doSaveSession();
  };
  $("close-tabs").onclick = () => void closeSavedTabs();
  $("save-bookmarks").onclick = () => void doSaveBookmarks();
  $("view-session").onclick = () =>
    lastSession && ext.tabs.create({ url: `${config.serverUrl}${lastSession.path}` });

  // Collections & tags (non-blocking)
  void api<{ collections: { id: string; name: string; icon: string | null }[] }>(
    "/api/v1/collections",
    { config },
  )
    .then(({ collections }) => {
      const sel = $<HTMLSelectElement>("collection");
      for (const c of collections)
        sel.add(new Option(`${c.icon ? c.icon + " " : ""}${c.name}`, c.id));
      sel.value = sel.dataset.want ?? config.defaultCollectionId ?? "";
    })
    .catch((err: Error) => status($("save-status"), err.message, "err"));
  void api<{ tags: string[] }>("/api/v1/tags", { config })
    .then(({ tags }) => {
      const dl = $("tag-list");
      for (const t of tags.slice(0, 200)) dl.appendChild(new Option(t));
    })
    .catch(() => {});
}

async function saveCurrent(opts: { closeTab?: boolean } = {}) {
  if (!currentTab || !isSavableUrl(currentTab.url)) return;
  const btn = $<HTMLButtonElement>("save");
  btn.disabled = true;
  $<HTMLButtonElement>("save-close").disabled = true;
  try {
    const collectionId = $<HTMLSelectElement>("collection").value;
    const r = await api<{ id: string; duplicate: boolean }>("/api/v1/saves", {
      config,
      body: {
        url: currentTab.url,
        title: $<HTMLInputElement>("title").value.trim() || undefined,
        faviconUrl: isSavableUrl(currentTab.favIconUrl) ? currentTab.favIconUrl : undefined,
        tags: splitTags($<HTMLInputElement>("tags").value),
        notes: $<HTMLTextAreaElement>("note").value.trim() || undefined,
        collectionIds: collectionId ? [collectionId] : [],
        bookmark: bookmarkChip.get() || undefined,
        // Already saved: the chip shows its current state, so send it either way.
        favorite: knownSave ? favoriteChip.get() : favoriteChip.get() || undefined,
        captureMethod: "extension",
      },
    });
    if (archiveChip.get()) {
      status($("save-status"), "✓ Saved. Archiving an offline copy…", "ok");
      try {
        await api(`/api/v1/saves/${encodeURIComponent(r.id)}/archive`, { config, method: "POST" });
      } catch (err) {
        status($("save-status"), `Saved, but archiving failed: ${(err as Error).message}`, "err");
        return;
      }
    }
    if (opts.closeTab && currentTab.id !== undefined) {
      await ext.tabs.remove(currentTab.id);
      window.close();
      return;
    }
    status(
      $("save-status"),
      r.duplicate ? "✓ Already saved — updated it." : "✓ Saved. You can close this tab.",
      "ok",
    );
    setTimeout(() => window.close(), 1100);
  } catch (err) {
    status($("save-status"), (err as Error).message, "err");
    btn.disabled = false;
    $<HTMLButtonElement>("save-close").disabled = false;
  }
}

async function takeScreenshot() {
  if (!currentTab?.windowId) return;
  try {
    const dataUrl = await ext.tabs.captureVisibleTab(currentTab.windowId, {
      format: "jpeg",
      quality: 85,
    });
    const collectionId = $<HTMLSelectElement>("collection").value;
    await api("/api/v1/saves/screenshot", {
      config,
      body: {
        dataUrl,
        title: `Screenshot — ${$<HTMLInputElement>("title").value || currentTab.title || "page"}`,
        sourceUrl: isSavableUrl(currentTab.url) ? currentTab.url : undefined,
        tags: splitTags($<HTMLInputElement>("tags").value),
        notes: $<HTMLTextAreaElement>("note").value.trim() || undefined,
        collectionIds: collectionId ? [collectionId] : [],
      },
    });
    status($("save-status"), "✓ Screenshot saved.", "ok");
    setTimeout(() => window.close(), 1100);
  } catch (err) {
    status($("save-status"), (err as Error).message, "err");
  }
}

async function doSaveSession() {
  const btn = $<HTMLButtonElement>("save-session");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const scope = $<HTMLInputElement>("all-windows").checked ? "all" : "window";
    const r = await saveSession(
      scope,
      $<HTMLInputElement>("session-name").value,
      splitTags($<HTMLInputElement>("session-tags").value),
    );
    lastSession = { path: `/sessions/${r.id}`, tabIds: r.tabIds };
    status(
      $("session-status"),
      `✓ Saved ${r.saved} tabs${r.skipped ? ` (${r.skipped} skipped)` : ""}. Safe to close them now.`,
      "ok",
    );
    $("session-buttons").classList.add("hidden");
    $("after-session").classList.remove("hidden");
  } catch (err) {
    status($("session-status"), (err as Error).message, "err");
    btn.disabled = false;
    btn.textContent = "Save session";
  }
}

async function doSaveBookmarks() {
  const btn = $<HTMLButtonElement>("save-bookmarks");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const scope = $<HTMLInputElement>("all-windows").checked ? "all" : "window";
    const r = await saveTabsAsBookmarks(scope);
    lastSession = { path: "/bookmarks", tabIds: r.tabIds };
    status(
      $("session-status"),
      `✓ ${r.added} added to Bookmarks${r.existing ? `, ${r.existing} already there` : ""}. Safe to close the tabs now.`,
      "ok",
    );
    $("session-buttons").classList.add("hidden");
    $("after-session").classList.remove("hidden");
  } catch (err) {
    status($("session-status"), (err as Error).message, "err");
    btn.disabled = false;
    btn.textContent = "As bookmarks";
  }
}

async function closeSavedTabs() {
  if (!lastSession) return;
  const keepPinned = $<HTMLInputElement>("keep-pinned").checked;
  const tabs = await Promise.all(
    lastSession.tabIds.map((id) => ext.tabs.get(id).catch(() => null)),
  );
  const toClose = tabs
    .filter((t): t is chrome.tabs.Tab => !!t && !(keepPinned && t.pinned))
    .map((t) => t.id!);
  // Leave the user somewhere useful instead of an empty window.
  await ext.tabs.create({ url: `${config.serverUrl}${lastSession.path}`, active: true });
  await ext.tabs.remove(toClose);
  window.close();
}

/** Is this page already in Tymo? Shows where, and the Inbox count in the header. */
async function lookupPage() {
  const url = isSavableUrl(currentTab?.url) ? currentTab!.url! : "";
  try {
    const r = await api<{
      inbox: number;
      save: {
        id: string;
        createdAt: number;
        isFavorite: boolean;
        isBookmark: boolean;
        tags: string[];
        collections: { id: string; name: string; icon: string | null }[];
      } | null;
    }>(`/api/v1/saves/lookup?url=${encodeURIComponent(url)}`, { config });
    if (r.inbox > 0) {
      $("inbox-count").textContent = String(r.inbox);
      $("inbox-pill").classList.remove("hidden");
      $("inbox-pill").onclick = () => void ext.tabs.create({ url: `${config.serverUrl}/inbox` });
    }
    const s = r.save;
    if (!s) return;
    const when = new Date(s.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const where = s.collections[0]
      ? `${s.collections[0].icon ? `${s.collections[0].icon} ` : ""}${s.collections[0].name}`
      : "Inbox";
    $("known-text").textContent = `Saved ${when} · ${where}`;
    $("known").classList.remove("hidden");
    $("known-open").onclick = (e) => {
      e.preventDefault();
      void ext.tabs.create({ url: `${config.serverUrl}/saves?open=${encodeURIComponent(s.id)}` });
      window.close();
    };
    $("save").textContent = "Update";
    knownSave = true;
    favoriteChip.set(s.isFavorite);
    if (s.isBookmark) bookmarkChip.set(true);
    const sel = $<HTMLSelectElement>("collection");
    if (s.collections[0]) {
      sel.dataset.want = s.collections[0].id;
      if ([...sel.options].some((o) => o.value === s.collections[0]!.id))
        sel.value = s.collections[0].id;
    }
    if (s.tags.length && !$<HTMLInputElement>("tags").value)
      $<HTMLInputElement>("tags").value = s.tags.join(", ");
  } catch {
    // An older Tymo without this endpoint: the popup works as before.
  }
}

/** Tabs open more than once (same address, ignoring #fragments). */
let duplicateIds: number[] = [];
async function findDuplicates() {
  const all = $<HTMLInputElement>("all-windows").checked;
  const tabs = await ext.tabs.query(all ? {} : { currentWindow: true });
  const seen = new Map<string, chrome.tabs.Tab>();
  duplicateIds = [];
  // Keep the active or pinned copy, close the others.
  const ordered = [...tabs].sort(
    (a, b) => Number(b.active || b.pinned) - Number(a.active || a.pinned),
  );
  for (const t of ordered) {
    if (!t.url || t.id === undefined) continue;
    const key = t.url.replace(/#.*$/, "");
    if (seen.has(key)) duplicateIds.push(t.id);
    else seen.set(key, t);
  }
  $("dupes").classList.toggle("hidden", duplicateIds.length === 0);
  $("dupes-text").textContent =
    `${duplicateIds.length} duplicate ${duplicateIds.length === 1 ? "tab" : "tabs"}`;
}
async function closeDuplicates() {
  if (!duplicateIds.length) return;
  await ext.tabs.remove(duplicateIds);
  status($("session-status"), `✓ Closed ${duplicateIds.length} duplicate tabs.`, "ok");
}

/** One clickable row: favicon, title, small grey line. */
function rowEl(opts: {
  title: string;
  meta: string;
  icon: string | null;
  site: string;
  onOpen: () => void;
}) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "item";
  row.setAttribute("role", "option");
  const grow = document.createElement("div");
  grow.className = "grow";
  const t = document.createElement("div");
  t.className = "t";
  t.textContent = opts.title; // textContent: server data is never parsed as HTML
  const meta = document.createElement("div");
  meta.className = "hint";
  meta.textContent = opts.meta;
  grow.append(t, meta);
  row.append(faviconEl(opts.icon, opts.site || opts.title), grow);
  row.onclick = opts.onOpen;
  return row;
}

/** Find with nothing typed: your most-used bookmarks, one click to open. */
async function showBookmarks() {
  const list = $("find-results");
  $("find-heading").textContent = "Your bookmarks";
  $("find-heading").classList.remove("hidden");
  try {
    const { items } = await api<{
      items: {
        id: string;
        title: string;
        url: string;
        domain: string | null;
        faviconUrl: string | null;
        openCount: number;
        folder: { name: string; icon: string | null } | null;
      }[];
    }>("/api/v1/bookmarks", { config });
    if ($<HTMLInputElement>("find-q").value.trim()) return;
    list.textContent = "";
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent =
        "No bookmarks yet. Turn on “Bookmark” when saving a site you come back to.";
      list.append(empty);
      return;
    }
    const top = [...items]
      .sort((a, b) => b.openCount - a.openCount || a.title.localeCompare(b.title))
      .slice(0, 10);
    for (const b of top)
      list.append(
        rowEl({
          title: b.title,
          meta: [b.domain, b.folder ? `${b.folder.icon ?? ""} ${b.folder.name}`.trim() : ""]
            .filter(Boolean)
            .join(" · "),
          icon: b.faviconUrl,
          site: b.domain ?? "",
          onOpen: () => {
            if (isSavableUrl(b.url)) void ext.tabs.create({ url: b.url });
            window.close();
          },
        }),
      );
    if (items.length > top.length) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "btn ghost wide";
      more.textContent = `All ${items.length} bookmarks ↗`;
      more.onclick = () => void ext.tabs.create({ url: `${config.serverUrl}/bookmarks` });
      list.append(more);
    }
  } catch (err) {
    showError(list, err);
  }
}

let findSeq = 0;

async function runFind(q: string) {
  const list = $("find-results");
  const seq = ++findSeq;
  if (!q.trim()) return;
  $("find-heading").classList.add("hidden");
  try {
    const res = await api<{
      items: {
        id: string;
        title: string;
        url: string | null;
        domain: string | null;
        faviconUrl?: string | null;
        type: string;
      }[];
      total: number;
    }>(`/api/v1/saves?limit=12&q=${encodeURIComponent(q)}`, { config });
    if (seq !== findSeq) return; // a newer query is in flight
    list.textContent = "";
    if (!res.items.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No matches.";
      list.append(empty);
      return;
    }
    for (const s of res.items) {
      // Only http(s) links are opened directly; everything else opens in Tymo.
      const target = isSavableUrl(s.url ?? undefined)
        ? s.url!
        : `${config.serverUrl}/saves?open=${encodeURIComponent(s.id)}`;
      list.append(
        rowEl({
          title: s.title,
          meta: s.domain ?? s.type,
          icon: s.faviconUrl ?? null,
          site: s.domain ?? "",
          onOpen: () => {
            void ext.tabs.create({ url: target });
            window.close();
          },
        }),
      );
    }
    if (res.total > res.items.length) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "btn ghost wide";
      more.textContent = `All ${res.total} results in Tymo ↗`;
      more.onclick = () =>
        void ext.tabs.create({ url: `${config.serverUrl}/saves?q=${encodeURIComponent(q)}` });
      list.append(more);
    }
  } catch (err) {
    if (seq === findSeq) showError(list, err);
  }
}

async function loadSessions() {
  const list = $("sessions");
  list.textContent = "Loading…";
  try {
    const { sessions } = await api<{
      sessions: {
        id: string;
        name: string;
        tabCount: number;
        createdAt: number;
        windows: number;
      }[];
    }>("/api/v1/sessions", { config });
    list.textContent = "";
    if (!sessions.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No sessions yet. Save your open tabs above to close them safely.";
      list.append(empty);
      return;
    }
    for (const s of sessions) {
      const row = document.createElement("div");
      row.className = "item";
      const grow = document.createElement("div");
      grow.className = "grow";
      const t = document.createElement("div");
      t.className = "t";
      t.textContent = s.name; // textContent: server data is never parsed as HTML
      const meta = document.createElement("div");
      meta.className = "hint";
      meta.textContent = `${s.tabCount} tabs${s.windows > 1 ? ` · ${s.windows} windows` : ""} · ${new Date(s.createdAt).toLocaleDateString()}`;
      grow.append(t, meta);
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.append(icon("rotate-ccw", 13), "Restore");
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = "Opening…";
        try {
          await restoreSession(s.id);
          window.close();
        } catch (err) {
          btn.textContent = "Failed";
          meta.textContent = (err as Error).message;
        }
      };
      row.append(grow, btn);
      list.append(row);
    }
  } catch (err) {
    showError(list, err);
  }
}

void init();
