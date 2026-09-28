import { quoteTitle, textFragmentUrl } from "@tymo/core/highlights";
import { api, ext, getConfig, isSavableUrl, saveSession } from "./api";

function flash(text: string, color: string, tabId?: number) {
  void ext.action.setBadgeBackgroundColor({ color, ...(tabId ? { tabId } : {}) });
  void ext.action.setBadgeText({ text, ...(tabId ? { tabId } : {}) });
  setTimeout(() => void ext.action.setBadgeText({ text: "", ...(tabId ? { tabId } : {}) }), 2500);
}
const ok = (tabId?: number) => flash("✓", "#6798ff", tabId);
const fail = (tabId?: number, err?: unknown) => {
  console.warn("[tymo]", err);
  flash("!", "#ff7a7a", tabId);
};

async function ensureConfigured() {
  if (await getConfig()) return true;
  await ext.runtime.openOptionsPage();
  return false;
}

async function saveTab(
  tab: chrome.tabs.Tab | undefined,
  method: "extension" | "extension-context-menu" = "extension",
) {
  if (!tab || !isSavableUrl(tab.url)) return fail(tab?.id, "Not a web page");
  if (!(await ensureConfigured())) return;
  try {
    const { defaultCollectionId } = (await ext.storage.local.get("defaultCollectionId")) as {
      defaultCollectionId?: string;
    };
    await api("/api/v1/saves", {
      body: {
        url: tab.url,
        title: tab.title,
        faviconUrl: isSavableUrl(tab.favIconUrl) ? tab.favIconUrl : undefined,
        collectionIds: defaultCollectionId ? [defaultCollectionId] : [],
        captureMethod: method,
      },
    });
    ok(tab.id);
  } catch (err) {
    fail(tab.id, err);
  }
}

async function screenshot(tab: chrome.tabs.Tab | undefined) {
  if (!tab?.windowId || !(await ensureConfigured())) return;
  try {
    const dataUrl = await ext.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 85 });
    await api("/api/v1/saves/screenshot", {
      body: {
        dataUrl,
        title: tab.title ? `Screenshot — ${tab.title}` : "Screenshot",
        sourceUrl: isSavableUrl(tab.url) ? tab.url : undefined,
      },
    });
    ok(tab.id);
  } catch (err) {
    fail(tab.id, err);
  }
}

function setupMenus() {
  ext.contextMenus.removeAll(() => {
    ext.contextMenus.create({ id: "save-page", title: "Save page to Tymo", contexts: ["page"] });
    ext.contextMenus.create({ id: "save-link", title: "Save link to Tymo", contexts: ["link"] });
    ext.contextMenus.create({
      id: "bookmark-page",
      title: "Add page to Tymo Bookmarks",
      contexts: ["page"],
    });
    ext.contextMenus.create({
      id: "bookmark-link",
      title: "Add link to Tymo Bookmarks",
      contexts: ["link"],
    });
    ext.contextMenus.create({
      id: "save-selection",
      title: "Save selection to Tymo",
      contexts: ["selection"],
    });
    ext.contextMenus.create({ id: "save-image", title: "Save image to Tymo", contexts: ["image"] });
    ext.contextMenus.create({
      id: "screenshot",
      title: "Save screenshot to Tymo",
      contexts: ["page"],
    });
  });
}

ext.runtime.onInstalled.addListener((details) => {
  setupMenus();
  if (details.reason === "install") void ext.runtime.openOptionsPage();
});
ext.runtime.onStartup?.addListener(setupMenus);

ext.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!(await ensureConfigured())) return;
  try {
    switch (info.menuItemId) {
      case "save-page":
        return saveTab(tab, "extension-context-menu");
      case "screenshot":
        return screenshot(tab);
      case "save-link":
        if (!isSavableUrl(info.linkUrl)) return fail(tab?.id, "Unsupported link");
        await api("/api/v1/saves", {
          body: {
            url: info.linkUrl,
            title: info.selectionText || undefined,
            source: tab?.url,
            captureMethod: "extension-context-menu",
          },
        });
        return ok(tab?.id);
      case "bookmark-page":
      case "bookmark-link": {
        const url = info.menuItemId === "bookmark-link" ? info.linkUrl : tab?.url;
        if (!isSavableUrl(url)) return fail(tab?.id, "Only web pages can be bookmarked");
        await api("/api/v1/saves", {
          body: {
            url,
            title:
              info.menuItemId === "bookmark-page" ? tab?.title : info.selectionText || undefined,
            faviconUrl:
              info.menuItemId === "bookmark-page" && isSavableUrl(tab?.favIconUrl)
                ? tab!.favIconUrl
                : undefined,
            bookmark: true,
            captureMethod: "extension-context-menu",
          },
        });
        return ok(tab?.id);
      }
      case "save-selection": {
        // Saved as a quote card that links back to the exact passage (URL text fragment).
        const text = (info.selectionText ?? "").slice(0, 20_000);
        const page = isSavableUrl(tab?.url) ? tab!.url! : undefined;
        await api("/api/v1/saves", {
          body: {
            type: "quote",
            title: quoteTitle(text),
            body: text,
            url: page ? textFragmentUrl(page, text) : undefined,
            faviconUrl: isSavableUrl(tab?.favIconUrl) ? tab!.favIconUrl : undefined,
            source: tab?.url,
            captureMethod: "extension-context-menu",
            metadata: page ? { sourceUrl: page, sourceTitle: tab?.title } : undefined,
          },
        });
        return ok(tab?.id);
      }
      case "save-image":
        if (!isSavableUrl(info.srcUrl)) return fail(tab?.id, "Only http(s) images can be saved");
        await api("/api/v1/saves", {
          body: {
            url: info.srcUrl,
            type: "image",
            imageUrl: info.srcUrl,
            title: tab?.title ? `Image from ${tab.title}` : undefined,
            source: tab?.url,
            captureMethod: "extension-context-menu",
          },
        });
        return ok(tab?.id);
    }
  } catch (err) {
    fail(tab?.id, err);
  }
});

ext.commands.onCommand.addListener(async (command, tab) => {
  const active = tab ?? (await ext.tabs.query({ active: true, currentWindow: true }))[0];
  if (command === "save-tab") return saveTab(active);
  if (command === "save-session") {
    if (!(await ensureConfigured())) return;
    try {
      await saveSession("window");
      ok(active?.id);
    } catch (err) {
      fail(active?.id, err);
    }
  }
});
