#!/usr/bin/env bash
# Run the UI smoke test (headless Chromium + fake Tauri/ACP backend) in the WSL VM.
# Screenshots land in <repo>/dist/screenshots.
#
#   wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/e2e.sh
set -euo pipefail
SRC="${AAR_UI_SRC:-/mnt/b/Github_my/aar_ui}"
WORK="$HOME/build/aar_ui"

rsync -a --delete \
  --exclude node_modules --exclude dist --exclude dist-web \
  --exclude src-tauri/target --exclude src-tauri/gen --exclude .git --exclude dist-py \
  "$SRC/" "$WORK/"
cd "$WORK"
[[ -d node_modules ]] || npm ci --no-audit --no-fund

# Playwright lives outside the app's dependencies (test tool only).
E2E="$HOME/e2e-tools"
if [[ ! -d "$E2E/node_modules/playwright" ]]; then
  mkdir -p "$E2E" && (cd "$E2E" && npm init -y >/dev/null && npm install --no-audit --no-fund playwright)
  (cd "$E2E" && npx playwright install --with-deps chromium)
fi
export NODE_PATH="$E2E/node_modules"
ln -sfn "$E2E/node_modules/playwright" node_modules/playwright
ln -sfn "$E2E/node_modules/playwright-core" node_modules/playwright-core

npx tsc --noEmit
npx vite --port 1420 --strictPort >/tmp/vite.log 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -sf http://localhost:1420/ >/dev/null && break; sleep 0.2; done

AAR_UI_SHOTS="$SRC/dist/screenshots" node tests/e2e/smoke.mjs
