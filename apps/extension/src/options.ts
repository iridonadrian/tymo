import { api, ext, getConfig, isLocalOrigin, normalizeServerUrl, setConfig } from "./api";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function show(text: string, kind: "ok" | "err") {
  const el = $("status");
  el.textContent = text;
  el.className = `status ${kind}`;
}

async function loadCollections(serverUrl: string, token: string, selected?: string) {
  try {
    const { collections } = await api<{
      collections: { id: string; name: string; icon: string | null }[];
    }>("/api/v1/collections", { config: { serverUrl, token } });
    const sel = $<HTMLSelectElement>("default-collection");
    sel.length = 1;
    for (const c of collections)
      sel.add(new Option(`${c.icon ? c.icon + " " : ""}${c.name}`, c.id));
    if (selected) sel.value = selected;
  } catch {
    /* shown by the connection test */
  }
}

async function init() {
  const c = await getConfig();
  $<HTMLInputElement>("server").value = c?.serverUrl ?? "http://127.0.0.1:3210";
  $<HTMLInputElement>("token").value = c?.token ?? "";
  if (c) void loadCollections(c.serverUrl, c.token, c.defaultCollectionId);

  $<HTMLFormElement>("form").onsubmit = async (e) => {
    e.preventDefault();
    let serverUrl: string;
    try {
      serverUrl = normalizeServerUrl($<HTMLInputElement>("server").value);
    } catch (err) {
      return show((err as Error).message, "err");
    }
    const token = $<HTMLInputElement>("token").value.trim();
    if (!token.startsWith("tymo_"))
      return show("That doesn't look like a Tymo token (it starts with tymo_).", "err");
    // Ask for access to exactly this origin — nothing else.
    const granted = await ext.permissions
      .request({ origins: [`${serverUrl}/*`] })
      .catch(() => false);
    if (!granted) return show("Permission to reach your server was declined.", "err");
    try {
      const r = await api<{ version: string }>("/api/v1/ping", { config: { serverUrl, token } });
      await setConfig({
        serverUrl,
        token,
        defaultCollectionId: $<HTMLSelectElement>("default-collection").value || undefined,
      });
      await loadCollections(serverUrl, token, $<HTMLSelectElement>("default-collection").value);
      const warn =
        serverUrl.startsWith("http:") && !isLocalOrigin(serverUrl)
          ? " Warning: this server uses plain HTTP; your token is sent unencrypted."
          : "";
      show(`✓ Connected to Tymo ${r.version}.${warn}`, warn ? "err" : "ok");
    } catch (err) {
      show((err as Error).message, "err");
    }
  };
  $("default-collection").onchange = () =>
    setConfig({
      defaultCollectionId: $<HTMLSelectElement>("default-collection").value || undefined,
    });
}

void init();
