#!/bin/bash
# Setup script for the Claude Code cloud environment ("Tymo").
# Paste the body of this file into claude.ai/code → environment selector → Tymo → Setup script.
# Runs as root on Ubuntu 24.04 before Claude starts; the result is cached (~7 days), so keep it < 5 min.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Node 22 is on PATH by default in the cloud image.
node --version

# Playwright's Chromium + system libraries for e2e tests (downloads from the Playwright CDN;
# the environment's network allowlist must include cdn.playwright.dev and playwright.download.prss.microsoft.com).
npx --yes playwright@1.63.0 install --with-deps chromium || echo "WARN: Playwright browser install failed; e2e tests will be unavailable"
