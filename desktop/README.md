# Tymo desktop

Tymo as a double-click app for macOS, Windows and Linux. It runs the web app's production
server (`apps/web`, Next.js standalone build) with Electron's own Node, bound to
`127.0.0.1`, and shows it in a window. Nothing else changes: same database, same port
(3210, so the browser extension connects as usual), same backups.

- Library: `<user data>/data` — `~/Library/Application Support/Tymo/data` on macOS (shared
  with `npm run mac:install`), `%APPDATA%\Tymo\data` on Windows, `~/.config/Tymo/data` on Linux.
- If a Tymo server already answers on port 3210, the app opens that one instead of starting
  a second server on the same library.
- Daily backups are on; on macOS they go to iCloud Drive → Tymo Backups when it exists.
  `TYMO_BACKUP_DIR` overrides the folder.
- Links to other sites open in the default browser; only `http(s)` and `mailto` are passed on.
- The server stops with the app, even if the app is killed.
- Updates: once a day (menu: Check for Updates Automatically) the app asks the GitHub
  releases API of the repository it was built from (`tymo.releases`, set by the release
  workflow) for the latest release, and offers to download the file for this OS/CPU
  (https, GitHub hosts only, size-checked), open it and quit. Unsigned apps can't replace
  themselves, so the user finishes the install. Development builds never check.

## Build

This folder is not an npm workspace, so the main install doesn't download Electron.

```bash
npm ci && npm run build -w @tymo/web   # repo root: the server
cd desktop && npm ci
npm start                              # run it
npm run dist                           # → dist/ (.dmg on macOS, .exe on Windows, AppImage on Linux)
```

Each platform is built on that platform (the database driver is a native module).
`.github/workflows/desktop.yml` does this on GitHub for every `v*` tag, or from the
Actions tab, and attaches the files to a Release.

Builds are unsigned: macOS gets an ad-hoc signature (users click **Open Anyway** once in
Privacy & Security), Windows shows SmartScreen once. Signing needs an Apple Developer ID
and a Windows code-signing certificate; electron-builder picks them up from `CSC_LINK` /
`CSC_KEY_PASSWORD` (and `APPLE_ID`… for notarization) when you add them as secrets.
