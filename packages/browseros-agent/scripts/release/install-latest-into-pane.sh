#!/usr/bin/env bash
# install-latest-into-pane.sh
#
# Install the latest server + extension build into the INSTALLED Pane app
# (/Applications/Pane.app) as a proper install: the app keeps launching
# normally (no special CLI flags) and the changes persist across browser
# and OS restarts — the intended way to test Pane throughout the day.
#
# What it does:
#   1. Quit Pane
#   2. Build server + claw bundles (working tree, --no-upload)
#   3. Swap server/claw resources into the app bundle
#   4. Build extension zip -> CRX (same PEM -> same id) and swap it in
#   5. Re-sign with the Developer ID identity using production specs
#   6. Clear quarantine (app is no longer notarized after local re-sign)
#   7. Verify + relaunch Pane
#
# Usage:
#   bash packages/browseros-agent/scripts/release/install-latest-into-pane.sh
#   bash .../install-latest-into-pane.sh server        # server only
#   bash .../install-latest-into-pane.sh extension     # extension only
#   bash .../install-latest-into-pane.sh --no-bump     # never auto-bump ext version
#
# Local only. The app is NOT notarized after this — never distribute it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
AGENT="$ROOT/packages/browseros-agent"
APP="${PANE_APP:-/Applications/Pane.app}"
TARGET=darwin-arm64
EXT_ID=biedncddmddkpapdplhcnkhhplnfgbif
SIGN="Developer ID Application: Abhishek Verma (4Z2UAB6AWC)"
APP_ENT="$ROOT/packages/browseros/resources/entitlements/app-entitlements.plist"
SERVER_ENT="$ROOT/packages/browseros/resources/entitlements/browseros-executable-entitlements.plist"
PROFILE_EXT="$HOME/Library/Application Support/Pane/Default/Extensions/$EXT_ID"

MODE=all
NO_BUMP=0
SERVER_RES="$APP/Contents/Resources/BrowserOSServer/default/resources"
CLAW_RES="$APP/Contents/Resources/BrowserOSClawServer/default/resources"
VERSION=""
for arg in "$@"; do
  case "$arg" in
    server|extension|all) MODE="$arg" ;;
    --no-bump) NO_BUMP=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

FW_VER="$(ls "$APP/Contents/Frameworks/Pane Framework.framework/Versions/" 2>/dev/null | grep -vx Current | head -1)"
if [ -z "$FW_VER" ]; then
  echo "Cannot resolve framework version dir in $APP" >&2; exit 1
fi
EXT_DIR="$APP/Contents/Frameworks/Pane Framework.framework/Versions/$FW_VER/Resources/browseros_extensions"

# ----------------------------------------------------------------------
log "Quitting Pane"
osascript -e 'quit app "Pane"' 2>/dev/null || true
sleep 2
pkill -x Pane 2>/dev/null || true
sleep 1

# ----------------------------------------------------------------------
# Server + claw
# ----------------------------------------------------------------------
if [ "$MODE" = all ] || [ "$MODE" = server ]; then
  log "Building server + claw bundles (working tree)"
  ( cd "$AGENT" && PANE_BUILD=true bun scripts/build/server.ts --target="$TARGET" --no-upload --ci )
  ( cd "$AGENT" && PANE_BUILD=true bun scripts/build/claw-server.ts --target="$TARGET" --no-upload --ci )


  log "Swapping server resources into the bundle"
  TMPD="$(mktemp -d /tmp/pane-swap.XXXXXX)"
  unzip -q -o "$AGENT/dist/prod/server/browseros-server-resources-$TARGET.zip" -d "$TMPD/server"
  unzip -q -o "$AGENT/dist/prod/claw-server/browseros-claw-server-resources-$TARGET.zip" -d "$TMPD/claw"
  # macOS signed-app bundles in /Applications prevent overwriting existing files
  # (chmod/utimensat on read-only files is silently ignored inside the bundle).
  # Workaround: remove old files first (directory write-bit allows unlinking),
  # then copy fresh.  Preserve bin/third_party/ — bun is not in the local zip.
  _swap_resources() {
    local src="$1" dest="$2"
    # Remove every top-level entry except bin/third_party/
    find "$dest" -mindepth 1 -maxdepth 1 | while IFS= read -r entry; do
      local base; base="$(basename "$entry")"
      if [ "$base" = "bin" ]; then
        # Inside bin, remove everything except third_party/
        find "$dest/bin" -mindepth 1 -maxdepth 1 ! -name 'third_party' -exec rm -rf {} +
      else
        rm -rf "$entry"
      fi
    done
    # Copy fresh (skip bin/third_party from source — it isn't there anyway)
    cp -R "$src/." "$dest/"
  }
  _swap_resources "$TMPD/server/resources" "$SERVER_RES"
  find "$CLAW_RES" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -R "$TMPD/claw/resources/." "$CLAW_RES/"

  log "Signing server executables (production specs)"
  codesign --force --sign "$SIGN" --options runtime --entitlements "$SERVER_ENT" \
    "$SERVER_RES/bin/browseros_server"
  [ -f "$SERVER_RES/bin/third_party/bun" ] && \
    codesign --force --sign "$SIGN" --options runtime --entitlements "$SERVER_ENT" \
      "$SERVER_RES/bin/third_party/bun"
  codesign --force --sign "$SIGN" --options runtime --entitlements "$SERVER_ENT" \
    "$CLAW_RES/bin/browseros-claw-server"
  # whisper dylibs / .node are covered by disable-library-validation; ad-hoc sign for safety
  find "$SERVER_RES/asr" -type f \( -name "*.dylib" -o -name "*.node" \) \
    -exec codesign --force --sign - {} \; 2>/dev/null || true
fi

# ----------------------------------------------------------------------
# Extension
# ----------------------------------------------------------------------
if [ "$MODE" = all ] || [ "$MODE" = extension ]; then
  EXT_PKG="$AGENT/apps/app/package.json"
  VERSION="$(python3 -c "import json;print(json.load(open('$EXT_PKG'))['version'])")"
  INSTALLED="$(ls "$PROFILE_EXT" 2>/dev/null | head -1 | sed 's/_0$//' || true)"

  if [ -n "$INSTALLED" ] && [ "$VERSION" = "$INSTALLED" ] && [ "$NO_BUMP" -eq 0 ]; then
    log "Extension $VERSION already installed in profile — bumping patch version"
    VERSION="$(python3 - "$EXT_PKG" <<'PY'
import json, re, sys
p = sys.argv[1]
s = open(p).read()
m = re.search(r'("version"\s*:\s*")(\d+)\.(\d+)\.(\d+)(")', s)
assert m, f"cannot parse version in {p}"
nv = f"{m.group(2)}.{m.group(3)}.{int(m.group(4)) + 1}"
open(p, "w").write(s[:m.start(1)] + m.group(1) + nv + m.group(5) + s[m.end(1):])
print(nv)
PY
)"
  fi

  log "Building extension zip + CRX (v$VERSION)"
  ( cd "$AGENT/apps/app" && bun run zip )
  AGENT_EXTENSION_PRIVATE_KEY="$(cat "$ROOT/secrets/pane-release/agent-extension.pem")" \
    bun "$AGENT/scripts/release/pack-extension-crx.ts" \
    --zip "$AGENT/apps/app/.output/pane-agent-$VERSION-chrome.zip" \
    --output "/tmp/pane-agent-$VERSION.crx" \
    --expected-app-id "$EXT_ID"

  log "Swapping CRX into the bundle"
  [ -f "$EXT_DIR/$EXT_ID.crx" ] && cp "$EXT_DIR/$EXT_ID.crx" /tmp/pane-agent-old.crx
  cp "/tmp/pane-agent-$VERSION.crx" "$EXT_DIR/$EXT_ID.crx"
fi

# ----------------------------------------------------------------------
# Re-sign framework + app, clear quarantine, verify, relaunch
# ----------------------------------------------------------------------
log "Re-signing framework + app (production flags)"
codesign --force --sign "$SIGN" "$APP/Contents/Frameworks/Pane Framework.framework"
codesign --force --sign "$SIGN" --options kill,restrict,library-validation,runtime \
  --entitlements "$APP_ENT" "$APP"

# Local re-sign means the app is no longer notarized; without clearing the
# quarantine xattr Gatekeeper would refuse to launch it.
log "Clearing quarantine"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

log "Verifying signature"
codesign --verify --deep --strict "$APP" && echo "codesign --verify --deep --strict: OK"

log "Launching Pane"
open -a Pane

echo
echo "Installed into $APP"
echo "  Server:    $("$SERVER_RES/bin/browseros_server" --version 2>/dev/null | head -1 || echo n/a)"
echo "  Extension: ${VERSION:-unchanged} (profile dir: $PROFILE_EXT)"
echo "Note: this local install is NOT notarized (expected). The next signed release restores notarization."
