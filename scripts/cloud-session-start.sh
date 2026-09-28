#!/bin/bash
# SessionStart hook: installs project dependencies in Claude Code cloud sessions only.
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi
cd "$CLAUDE_PROJECT_DIR" || exit 0
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund >/tmp/npm-ci.log 2>&1 || { tail -20 /tmp/npm-ci.log; exit 0; }
fi
exit 0
