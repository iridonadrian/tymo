#!/usr/bin/env bash
# Installs (or updates) Tymo on macOS without Docker.
#
#   ./scripts/mac/install.sh
#
# - Builds Tymo and copies it to ~/Library/Application Support/Tymo/app
# - Keeps your library in ~/Library/Application Support/Tymo/data (Time Machine backs it up)
# - Starts it in the background now and at every login (a per-user LaunchAgent, no admin rights)
# - Listens on 127.0.0.1 only: nothing on your network can reach it
# - Writes a daily backup to iCloud Drive when it's available (or set TYMO_BACKUP_DIR yourself)
#
# Re-run it after `git pull` to update. Remove with ./scripts/mac/uninstall.sh (keeps your data).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
HOME_DIR="$HOME/Library/Application Support/Tymo"
APP="$HOME_DIR/app"
DATA="$HOME_DIR/data"
PORT="${TYMO_PORT:-3210}"
LABEL="app.tymo.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/Tymo.log"

say() { printf '\033[1m›\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "This installer is for macOS. Elsewhere: npm ci && npm run build && npm start."

# 1. Node.js 22.12+ (free): https://nodejs.org or `brew install node`
NODE="$(command -v node || true)"
[[ -n "$NODE" ]] || die "Node.js is not installed. Get the LTS installer from https://nodejs.org (or run: brew install node), then run this again."
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$("$NODE" -p 'process.versions.node.split(".")[1]')"
if (( NODE_MAJOR < 22 || (NODE_MAJOR == 22 && NODE_MINOR < 12) )); then
  die "Tymo needs Node.js 22.12 or newer (you have $("$NODE" -v)). Update it from https://nodejs.org."
fi

# 2. Build
say "Installing dependencies and building (a few minutes the first time)…"
cd "$REPO"
npm ci --no-audit --no-fund >/dev/null
npm run build -w @tymo/web >/dev/null

# 3. Copy the self-contained server out of the repo, so the repo can move or change freely
say "Copying the app to ~/Library/Application Support/Tymo…"
mkdir -p "$HOME_DIR" "$DATA" "$(dirname "$PLIST")" "$(dirname "$LOG")"
chmod 700 "$HOME_DIR" "$DATA"
STAGE="$HOME_DIR/app.new"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R apps/web/.next/standalone/. "$STAGE/"
mkdir -p "$STAGE/apps/web/.next"
cp -R apps/web/.next/static "$STAGE/apps/web/.next/static"
cp -R apps/web/public "$STAGE/apps/web/public"
cp -R apps/web/drizzle "$STAGE/apps/web/drizzle"

# 4. Backups off this Mac: iCloud Drive if present (free), unless you chose a folder
BACKUP_DIR="${TYMO_BACKUP_DIR:-}"
ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
if [[ -z "$BACKUP_DIR" && -d "$ICLOUD" ]]; then BACKUP_DIR="$ICLOUD/Tymo Backups"; fi

xml() { local s="$1"; s="${s//&/&amp;}"; s="${s//</&lt;}"; s="${s//>/&gt;}"; printf '%s' "$s"; }

# 5. LaunchAgent: start now, at login, and restart if it ever stops
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -rf "$APP"
mv "$STAGE" "$APP"
{
  cat <<PLIST_HEAD
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE")</string>
    <string>$(xml "$APP/apps/web/server.js")</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$APP")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>HOSTNAME</key><string>127.0.0.1</string>
    <key>PORT</key><string>$PORT</string>
    <key>TYMO_DATA_DIR</key><string>$(xml "$DATA")</string>
    <key>TYMO_MIGRATIONS_DIR</key><string>$(xml "$APP/apps/web/drizzle")</string>
    <key>TYMO_AUTO_BACKUP</key><string>1</string>
    <key>NEXT_TELEMETRY_DISABLED</key><string>1</string>
PLIST_HEAD
  if [[ -n "$BACKUP_DIR" ]]; then
    printf '    <key>TYMO_BACKUP_DIR</key><string>%s</string>\n' "$(xml "$BACKUP_DIR")"
  fi
  cat <<PLIST_TAIL
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG")</string>
</dict>
</plist>
PLIST_TAIL
} > "$PLIST"
chmod 600 "$PLIST"
launchctl bootstrap "gui/$(id -u)" "$PLIST"

say "Starting Tymo…"
for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null || die "Tymo didn't start. See $LOG"

cat <<DONE

  ✓ Tymo is running at http://127.0.0.1:$PORT and starts automatically when you log in.
    Library: ~/Library/Application Support/Tymo/data
DONE
if [[ -n "$BACKUP_DIR" ]]; then
  echo "    Daily backups: ${BACKUP_DIR/#$HOME/~}"
else
  echo "    Daily backups: in the data folder. For a copy off this Mac, re-run with"
  echo "    TYMO_BACKUP_DIR=\"/path/to/Dropbox/Tymo Backups\" ./scripts/mac/install.sh"
fi
cat <<'APP'

  Make it an app (its own window and Dock icon, no browser bars):
    Safari:      File → Add to Dock…
    Chrome/Dia:  ⋮ menu → Cast, save and share → Install page as app…

APP
open "http://127.0.0.1:$PORT"
