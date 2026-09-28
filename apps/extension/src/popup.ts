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
let currentTab: chrome.tabs.Tab | undefined;
/** What was just saved from the tabs panel, and where Tymo shows it. */
let lastSession: { path: string; tabIds: number[] } | null = null;

async function init() {
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
  const tabs = ["save", "session", "restore", "find"] as const;
  for (const t of tabs) {
    $(`tab-${t}`).onclick = () => {
      for (const o of tabs) {
        $(`tab-${o}`).setAttribute("aria-selected", String(o === t));
        $(`panel-${o}`).classList.toggle("hidden", o !== t);
      }
      if (t === "restore") void loadSessions();
      if (t === "session") $<HTMLInputElement>("session-name").focus();
      if (t === "find") $<HTMLInputElement>("find-q").focus();
    };
  }

  // Find panel: debounced search over the whole library.
  let findTimer: ReturnType<typeof setTimeout> | undefined;
  const findInput = $<HTMLInputElement>("find-q");
  findInput.oninput = () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(() => void runFind(findInput.value), 220);
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
  const fav = $<HTMLImageElement>("fav");
  if (isSavableUrl(currentTab?.favIconUrl)) fav.src = currentTab!.favIconUrl!;
  else fav.style.visibility = "hidden";
  if (!isSavableUrl(currentTab?.url)) {
    status(
      $("save-status"),
      "This page can't be saved (only http/https pages). Try Session.",
      "err",
    );
    $<HTMLButtonElement>("save").disabled = true;
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
      if (active === "session") $<HTMLFormElement>("panel-session").requestSubmit();
    }
  });
  $("screenshot").onclick = () => void takeScreenshot();
  const archiveBox = $<HTMLInputElement>("archive-copy");
  void ext.storage.local.get("archiveOnSave").then((v) => {
    archiveBox.checked = !!(v as { archiveOnSave?: boolean }).archiveOnSave;
  });
  archiveBox.onchange = () => void ext.storage.local.set({ archiveOnSave: archiveBox.checked });
  const bookmarkBox = $<HTMLInputElement>("as-bookmark");
  void ext.storage.local.get("bookmarkOnSave").then((v) => {
    bookmarkBox.checked = !!(v as { bookmarkOnSave?: boolean }).bookmarkOnSave;
  });
  bookmarkBox.onchange = () => void ext.storage.local.set({ bookmarkOnSave: bookmarkBox.checked });

  // Session panel
  $<HTMLInputElement>("session-name").value = defaultSessionName();
  const updateCount = async () => {
    const { payload, skipped } = await collectTabs(
      $<HTMLInputElement>("all-windows").checked ? "all" : "window",
    );
    $("tab-count").textContent = String(payload.length);
    $("tab-count-label").textContent =
      `web pages ${$<HTMLInputElement>("all-windows").checked ? "in all windows" : "in this window"}${skipped ? ` · ${skipped} skipped` : ""}`;
  };
  $("all-windows").onchange = () => void updateCount();
  void updateCount();
  $<HTMLFormElement>("panel-session").onsubmit = (e) => {
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
      if (config.defaultCollectionId) sel.value = config.defaultCollectionId;
    })
    .catch((err: Error) => status($("save-status"), err.message, "err"));
  void api<{ tags: string[] }>("/api/v1/tags", { config })
    .then(({ tags }) => {
      const dl = $("tag-list");
      for (const t of tags.slice(0, 200)) dl.appendChild(new Option(t));
    })
    .catch(() => {});
}

async function saveCurrent() {
  if (!currentTab || !isSavableUrl(currentTab.url)) return;
  const btn = $<HTMLButtonElement>("save");
  btn.disabled = true;
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
        bookmark: $<HTMLInputElement>("as-bookmark").checked || undefined,
        captureMethod: "extension",
      },
    });
    if ($<HTMLInputElement>("archive-copy").checked) {
      status($("save-status"), "✓ Saved. Archiving an offline copy…", "ok");
      try {
        await api(`/api/v1/saves/${encodeURIComponent(r.id)}/archive`, { config, method: "POST" });
      } catch (err) {
        status($("save-status"), `Saved, but archiving failed: ${(err as Error).message}`, "err");
        return;
      }
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
    btn.classList.add("hidden");
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
    btn.classList.add("hidden");
    $("save-session").classList.add("hidden");
    $("after-session").classList.remove("hidden");
  } catch (err) {
    status($("session-status"), (err as Error).message, "err");
    btn.disabled = false;
    btn.textContent = "🔖 Save tabs as bookmarks";
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

let findSeq = 0;

async function runFind(q: string) {
  const list = $("find-results");
  const seq = ++findSeq;
  if (!q.trim()) {
    list.textContent = "";
    return;
  }
  try {
    const res = await api<{
      items: {
        id: string;
        title: string;
        url: string | null;
        domain: string | null;
        type: string;
      }[];
      total: number;
    }>(`/api/v1/saves?limit=12&q=${encodeURIComponent(q)}`, { config });
    if (seq !== findSeq) return; // a newer query is in flight
    list.textContent = "";
    if (!res.items.length) {
      const empty = document.createElement("p");
      empty.className = "hint center";
      empty.textContent = "No matches.";
      list.append(empty);
      return;
    }
    for (const s of res.items) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "item";
      row.setAttribute("role", "option");
      const grow = document.createElement("div");
      grow.className = "grow";
      const t = document.createElement("div");
      t.className = "t";
      t.textContent = s.title; // textContent: server data is never parsed as HTML
      const meta = document.createElement("div");
      meta.className = "hint";
      meta.textContent = s.domain ?? s.type;
      grow.append(t, meta);
      row.append(grow);
      // Only http(s) links are opened directly; everything else opens in Tymo.
      const target = isSavableUrl(s.url ?? undefined)
        ? s.url!
        : `${config.serverUrl}/saves?q=${encodeURIComponent(s.title)}`;
      row.onclick = () => {
        void ext.tabs.create({ url: target });
        window.close();
      };
      list.append(row);
    }
    if (res.total > res.items.length) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "btn ghost";
      more.textContent = `All ${res.total} results in Tymo ↗`;
      more.onclick = () =>
        void ext.tabs.create({ url: `${config.serverUrl}/saves?q=${encodeURIComponent(q)}` });
      list.append(more);
    }
  } catch (err) {
    if (seq === findSeq) list.textContent = (err as Error).message;
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
      empty.className = "hint center";
      empty.textContent = "No sessions yet. Use the Session tab to save your open tabs.";
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
      btn.textContent = "Restore";
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
    list.textContent = (err as Error).message;
  }
}

void init();
