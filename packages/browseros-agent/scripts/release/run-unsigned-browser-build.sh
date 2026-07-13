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

if ! command -v gn >/dev/null 2>&1; then
  for depot_tools in \
    "${DEPOT_TOOLS:-}" \
    "$HOME/chromium/depot_tools" \
    "$HOME/depot_tools"; do
    if [ -n "$depot_tools" ] && [ -x "$depot_tools/gn" ]; then
      export PATH="$depot_tools:$PATH"
      break
    fi
  done
fi

if ! command -v gn >/dev/null 2>&1; then
  echo "gn not found. Add depot_tools to PATH or set DEPOT_TOOLS." >&2
  exit 1
fi

mkdir -p "$BROWSEROS/logs"
cd "$BROWSEROS"

"$ROOT/packages/browseros-agent/scripts/release/stage-pane-browser-resources.sh" darwin-arm64

# Choose config: incremental if Chromium tree is already at the right tag,
# full (with clean + gclient sync) otherwise.
INCREMENTAL_CONFIG="build/config/release.macos.arm64.unsigned.incremental.yaml"
FULL_CONFIG="build/config/release.macos.arm64.unsigned.local.yaml"
BUILD_CONFIG="$FULL_CONFIG"

if [ -d "$CHROMIUM_SRC/.git" ]; then
  CURRENT_TAG=$(git -C "$CHROMIUM_SRC" describe --tags --exact-match 2>/dev/null || git -C "$CHROMIUM_SRC" rev-parse --abbrev-ref HEAD 2>/dev/null)
  if echo "$CURRENT_TAG" | grep -qE "148\.0\.7778\.97|browseros"; then
    echo "Chromium tree at $CURRENT_TAG — using incremental config (skipping clean + gclient sync)"
    rm -f "$CHROMIUM_SRC/.git/index.lock"
    git -C "$CHROMIUM_SRC" reset --hard tags/148.0.7778.97
    git -C "$CHROMIUM_SRC" clean -fdq
    BUILD_CONFIG="$INCREMENTAL_CONFIG"
  else
    echo "Chromium tree at $CURRENT_TAG — using full config (clean + gclient sync required)"
  fi
fi

exec >>"$LOG" 2>&1
echo "=== Pane unsigned browser build started $(date) config=$BUILD_CONFIG ==="
uv run browseros build \
  --config "$BUILD_CONFIG" \
  --chromium-src "$CHROMIUM_SRC"
BUILD_EXIT=$?
echo "=== Pane unsigned browser build finished $(date) exit=$BUILD_EXIT ==="

if [ "$BUILD_EXIT" -ne 0 ]; then
  exit "$BUILD_EXIT"
fi

# package_macos + sparkle_sign are in the yaml config; log DMG path when present.
VERSION_DIR="$BROWSEROS/releases"
if [ -d "$VERSION_DIR" ]; then
  find "$VERSION_DIR" -maxdepth 2 -name '*.dmg' -print
fi
