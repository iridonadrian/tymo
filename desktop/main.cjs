/**
 * Tymo desktop: a window around the same server the web version runs. The server is the
 * Next.js standalone build in resources/server, started with Electron's own Node, bound to
 * 127.0.0.1 only. Links to other sites open in your normal browser.
 */
const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { fork } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const updater = require("./updater.cjs");

const PREFERRED_PORT = 3210; // same as the web version, so the browser extension just works
const isMac = process.platform === "darwin";

if (!app.requestSingleInstanceLock()) app.quit();

const userData = app.getPath("userData");
const dataDir = path.join(userData, "data");
const logFile = path.join(userData, "logs", "server.log");
const serverRoot = app.isPackaged
  ? path.join(process.resourcesPath, "server")
  : path.join(__dirname, "server");

/** iCloud Drive when it is switched on (macOS); elsewhere backups stay next to the data. */
function defaultBackupDir() {
  if (process.env.TYMO_BACKUP_DIR) return process.env.TYMO_BACKUP_DIR;
  if (!isMac) return undefined;
  const icloud = path.join(os.homedir(), "Library/Mobile Documents/com~apple~CloudDocs");
  return fs.existsSync(icloud) ? path.join(icloud, "Tymo Backups") : undefined;
}

let server = null;
let baseUrl = null;
let win = null;
let quitting = false;

function get(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c.length < 2048 ? c : ""));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

/** "current" for a Tymo from this release line, "old" for one from before the desktop app
 *  existed (its health check doesn't name itself), null when no Tymo answers. */
async function tymoAt(port) {
  const r = await get(`http://127.0.0.1:${port}/api/health`);
  if (!r || r.status !== 200) return null;
  try {
    const body = JSON.parse(r.body);
    if (body.ok !== true) return null;
    return body.app === "tymo" ? "current" : "old";
  } catch {
    return null;
  }
}

async function isTymo(port) {
  return (await tymoAt(port)) === "current";
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startServer() {
  // Tymo already running on this computer (e.g. installed with `npm run mac:install`):
  // use it rather than opening the same library twice.
  const running = await tymoAt(PREFERRED_PORT);
  if (running === "current") return `http://127.0.0.1:${PREFERRED_PORT}`;
  if (running === "old") {
    const { response } = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Quit", "Open the older version"],
      defaultId: 0,
      cancelId: 0,
      message: "An older version of Tymo is already running on this computer",
      detail:
        `It answers at http://127.0.0.1:${PREFERRED_PORT} (probably started from Terminal or ` +
        "Docker), so this app would only show that older version.\n\nStop it (Ctrl+C in its " +
        "Terminal window, or `docker compose down`), then open Tymo again. To keep its saves, " +
        "first download a backup there (Settings → Backup & restore) and restore it here.",
    });
    if (response === 0) throw Object.assign(new Error("older Tymo running"), { quiet: true });
    return `http://127.0.0.1:${PREFERRED_PORT}`;
  }

  const port = (await portIsFree(PREFERRED_PORT)) ? PREFERRED_PORT : await freePort();
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.openSync(logFile, "a");
  const backupDir = defaultBackupDir();

  server = fork(path.join(__dirname, "server-entry.cjs"), [], {
    cwd: path.join(serverRoot, "apps/web"),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      TYMO_SERVER_ENTRY: path.join(serverRoot, "apps/web/server.js"),
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      TYMO_DATA_DIR: dataDir,
      TYMO_MIGRATIONS_DIR: path.join(serverRoot, "apps/web/drizzle"),
      TYMO_AUTO_BACKUP: process.env.TYMO_AUTO_BACKUP ?? "1",
      ...(backupDir ? { TYMO_BACKUP_DIR: backupDir } : {}),
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", log, log, "ipc"],
    windowsHide: true,
  });
  server.on("exit", (code) => {
    server = null;
    if (quitting) return;
    dialog.showErrorBox(
      "Tymo stopped",
      `The Tymo server exited (code ${code}). Details are in:\n${logFile}`,
    );
    app.quit();
  });

  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 300; i++) {
    if (await isTymo(port)) return url;
    if (!server) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Tymo didn't start. Details are in:\n${logFile}`);
}

function isAppUrl(url) {
  return !!baseUrl && (url === baseUrl || url.startsWith(baseUrl + "/"));
}

/** Only real web links leave the app, and they go to the default browser. */
function openOutside(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:")
      shell.openExternal(u.toString());
  } catch {
    /* not a URL */
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 380,
    minHeight: 500,
    title: "Tymo",
    backgroundColor: "#0e0f11",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url) && new URL(url).pathname.startsWith("/files/")) return { action: "allow" };
    openOutside(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isAppUrl(url) || url.startsWith("data:")) return;
    e.preventDefault();
    openOutside(url);
  });
  win.on("closed", () => (win = null));
  win.loadFile(path.join(__dirname, "loading.html"));
}

function buildMenu() {
  const updateItems = updater.hasReleaseSource()
    ? [
        {
          label: "Check for Updates…",
          click: () => updater.checkForUpdates({ manual: true, getWindow: () => win }),
        },
        {
          label: "Check for Updates Automatically",
          type: "checkbox",
          checked: updater.automaticChecksEnabled(),
          click: (item) => updater.setAutomaticChecks(item.checked),
        },
      ]
    : [];
  const template = [
    ...(isMac
      ? [
          {
            role: "appMenu",
            submenu: [
              { role: "about" },
              ...(updateItems.length ? [{ type: "separator" }, ...updateItems] : []),
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        { label: "Open in Browser", click: () => baseUrl && shell.openExternal(baseUrl) },
        { label: "Show Library Folder", click: () => shell.openPath(dataDir) },
        {
          label: "Show Backups Folder",
          click: () => {
            const dir = defaultBackupDir() ?? path.join(dataDir, "backups");
            fs.mkdirSync(dir, { recursive: true });
            shell.openPath(dir);
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
      ],
    },
    {
      label: "Navigate",
      submenu: [
        {
          label: "Back",
          accelerator: "CmdOrCtrl+[",
          click: () => win?.webContents.navigationHistory.goBack(),
        },
        {
          label: "Forward",
          accelerator: "CmdOrCtrl+]",
          click: () => win?.webContents.navigationHistory.goForward(),
        },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        ...(!isMac && updateItems.length ? [...updateItems, { type: "separator" }] : []),
        { label: "Server Log", click: () => shell.openPath(logFile) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on("before-quit", () => {
  quitting = true;
  server?.kill();
});

app.on("window-all-closed", () => {
  // macOS apps stay open without windows; the server keeps running for the extension.
  if (!isMac) app.quit();
});

app.on("activate", () => {
  if (!win && baseUrl) {
    createWindow();
    win.webContents.once("did-finish-load", () => win.loadURL(baseUrl));
  }
});

app.whenReady().then(async () => {
  buildMenu();
  createWindow();
  try {
    baseUrl = await startServer();
    win?.loadURL(baseUrl);
    updater.startAutomaticChecks(() => win);
  } catch (err) {
    if (!err?.quiet) dialog.showErrorBox("Tymo couldn't start", String(err?.message ?? err));
    app.quit();
  }
});
