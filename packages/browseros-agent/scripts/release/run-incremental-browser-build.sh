#!/usr/bin/env bash
# Resume browser build after a small C++ patch fix without resetting Chromium.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
BROWSEROS="$ROOT/packages/browseros"
LOG="$BROWSEROS/logs/unsigned-release-build.log"
CHROMIUM_SRC="${CHROMIUM_SRC:-/Users/abhishek/chromium/src}"
PATCH_DIR="$BROWSEROS/chromium_patches/chrome/browser/browseros/core"
CAPTURE_PATCH_SCRIPT="$ROOT/packages/browseros-agent/scripts/release/apply-capture-patches.sh"

if [ -f "$BROWSEROS/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$BROWSEROS/.env"
  set +a
fi

if [ -d /Applications/Xcode.app/Contents/Developer ]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

for depot_tools in \
  "${DEPOT_TOOLS:-}" \
  "$HOME/chromium/depot_tools" \
  "$HOME/depot_tools"; do
  if [ -n "$depot_tools" ] && [ -x "$depot_tools/gn" ]; then
    export PATH="$depot_tools:$PATH"
    break
  fi
done

apply_patch_file() {
  local patch="$1"
  local dest="$2"
  python3 - <<PY
from pathlib import Path
patch = Path("$patch")
dest = Path("$dest")
lines = []
for line in patch.read_text().splitlines():
    if line.startswith("+") and not line.startswith("+++"):
        lines.append(line[1:])
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text("\n".join(lines) + ("\n" if lines else ""))
print(f"Applied {dest} ({len(lines)} lines)")
PY
}

main() {
  echo "=== Pane incremental browser build started $(date) ==="
  echo "Applying fixed browseros_prefs sources from patches..."

  apply_patch_file "$PATCH_DIR/browseros_prefs.h" \
    "$CHROMIUM_SRC/chrome/browser/browseros/core/browseros_prefs.h"
  apply_patch_file "$PATCH_DIR/browseros_prefs.cc" \
    "$CHROMIUM_SRC/chrome/browser/browseros/core/browseros_prefs.cc"

  echo "Applying Phase 6 captureTabAudio patches..."
  CHROMIUM_SRC="$CHROMIUM_SRC" bash "$CAPTURE_PATCH_SCRIPT"

  cd "$BROWSEROS"
  "$ROOT/packages/browseros-agent/scripts/release/stage-pane-browser-resources.sh" darwin-arm64

  echo "Compiling chrome + chromedriver (incremental)..."
  cd "$CHROMIUM_SRC"
  echo "Regenerating GN files after IDL change..."
  if ! command -v gn >/dev/null 2>&1; then
    echo "gn not found on PATH: $PATH" >&2
    return 1
  fi
  gn gen out/Default_arm64
  # Force both the shared-library link and app-bundle copy. Removing only the
  # bundle copy leaves Ninja's real solink output current and can package stale
  # browser code.
  rm -f \
    "out/Default_arm64/obj/chrome/chrome_framework_shared_library/Pane Framework" \
    "out/Default_arm64/obj/chrome/chrome_framework_shared_library/Pane Framework.TOC"
  # Avoid zsh nomatch abort when the framework copy is already absent.
  find out/Default_arm64/Pane.app/Contents/Frameworks \
    -path '*/Pane Framework.framework/Versions/*/Pane Framework' \
    -delete 2>/dev/null || true
  if ! autoninja -C out/Default_arm64 chrome chromedriver; then
    echo "Compile failed; skipping packaging."
    return 1
  fi

  echo "Packaging DMG..."
  cd "$BROWSEROS"
  if ! uv run browseros build \
    --modules package_macos,sparkle_sign \
    --chromium-src "$CHROMIUM_SRC"; then
    echo "Packaging failed."
    return 1
  fi

  VERSION_DIR="$BROWSEROS/releases"
  if [ -d "$VERSION_DIR" ]; then
    find "$VERSION_DIR" -maxdepth 2 -name '*.dmg' -print
  fi
}

mkdir -p "$BROWSEROS/logs"
set +e
main >>"$LOG" 2>&1
BUILD_EXIT=$?
set -e
echo "=== Pane unsigned browser build finished $(date) exit=$BUILD_EXIT ===" >>"$LOG"
exit "$BUILD_EXIT"
