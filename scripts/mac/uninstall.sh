#!/usr/bin/env bash
# Stops Tymo and removes it from login items. Your library stays in
# ~/Library/Application Support/Tymo/data unless you pass --delete-data.
set -euo pipefail
LABEL="app.tymo.server"
HOME_DIR="$HOME/Library/Application Support/Tymo"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME_DIR/app" "$HOME_DIR/app.new"
if [[ "${1:-}" == "--delete-data" ]]; then
  read -r -p "Delete your whole Tymo library in $HOME_DIR? Type DELETE to confirm: " answer
  [[ "$answer" == "DELETE" ]] && rm -rf "$HOME_DIR" && echo "Library deleted."
else
  echo "Tymo removed. Your library is still in ~/Library/Application Support/Tymo/data"
fi
