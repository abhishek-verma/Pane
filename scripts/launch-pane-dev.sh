#!/usr/bin/env bash
# Launch Pane Dev with the local Pane extension (no CDN bundled extensions).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_ROOT="$ROOT/packages/browseros-agent"
EXT_DIR="$AGENT_ROOT/apps/app/dist/chrome-mv3"
PANE_BINARY="${PANE_BINARY:-$HOME/chromium/src/out/Default_arm64/Pane Dev.app/Contents/MacOS/Pane Dev}"
PROFILE="${PANE_USER_DATA_DIR:-/tmp/pane-dev-profile}"

if [[ ! -x "$PANE_BINARY" ]]; then
  echo "Pane Dev binary not found: $PANE_BINARY" >&2
  echo "Set PANE_BINARY to your built Pane Dev.app/Contents/MacOS/Pane Dev" >&2
  exit 1
fi

if [[ ! -d "$EXT_DIR" ]]; then
  echo "Extension not built. Run: cd $AGENT_ROOT/apps/app && bun run build" >&2
  exit 1
fi

mkdir -p "$PROFILE"

exec "$PANE_BINARY" \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  --disable-browseros-extensions \
  --disable-browseros-server \
  --load-extension="$EXT_DIR" \
  "$@"
