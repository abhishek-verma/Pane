#!/usr/bin/env bash
# Durable background unsigned browser build (survives agent shell exit).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
BROWSEROS="$ROOT/packages/browseros"
LOG="$BROWSEROS/logs/unsigned-release-build.log"
CHROMIUM_SRC="${CHROMIUM_SRC:-/Users/abhishek/chromium/src}"

if [ -f "$BROWSEROS/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$BROWSEROS/.env"
  set +a
fi

if [ -d /Applications/Xcode.app/Contents/Developer ]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

mkdir -p "$BROWSEROS/logs"
cd "$BROWSEROS"

"$ROOT/packages/browseros-agent/scripts/release/stage-pane-browser-resources.sh" darwin-arm64

# Fresh Chromium tree required when using the fast config (no clean step).
if [ -d "$CHROMIUM_SRC/.git" ]; then
  git -C "$CHROMIUM_SRC" reset --hard tags/148.0.7778.97
  git -C "$CHROMIUM_SRC" clean -fdq
fi

exec >>"$LOG" 2>&1
echo "=== Pane unsigned browser build started $(date) ==="
uv run browseros build \
  --config build/config/release.macos.arm64.unsigned.fast.yaml \
  --chromium-src "$CHROMIUM_SRC"
echo "=== Pane unsigned browser build finished $(date) exit=$? ==="
