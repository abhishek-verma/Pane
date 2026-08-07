#!/usr/bin/env bash
# Resume a browser signed release that was interrupted after signing.
#
# Use when:
#   - Browser:    BROWSEROS_VERSION already bumped + committed
#   - Extension:  package.json bumped, CRX published as agent-extension/v<ext-version>
#   - Server:     rebuilt and staged
#   - Signing:    PASSED (codesign --verify --deep --strict passed cleanly)
#   - Notarize:   SUBMITTED — notarytool is running (or has run). The build process
#                 (sign_macos -> package_macos -> sparkle_sign) may still be running
#                 in a terminal, or may have completed / failed.
#
# What to do when you come back:
#
#   1. Check if the original build process finished (look for its log, e.g.
#      /tmp/pane-build-repackage-phase2b.log): "Pipeline completed successfully"
#      or an error.
#
#   2a. If it completed successfully — this script's STEP A is a no-op (DMG
#       already at releases/<version>/) and it skips straight to verify + ship.
#
#   2b. If notarytool timed out or the terminal died — this script re-runs
#       ONLY package+sparkle (the app is already signed — skip sign_macos to
#       avoid re-signing).
#
# Usage:
#   bash packages/browseros-agent/scripts/release/resume-signed-browser-release.sh <version>
#   e.g. bash .../resume-signed-browser-release.sh 0.47.0.54
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <version>   e.g. $0 0.47.0.54" >&2
  exit 2
fi
VERSION="$1"

cd "$(dirname "$0")/../../../.."   # -> repo root (scripts/release + 4 = Pane root)
REPO_ROOT="$(pwd)"
cd packages/browseros

export MACOS_CERTIFICATE_NAME="Developer ID Application: Abhishek Verma (4Z2UAB6AWC)"
export NOTARY_KEY="$REPO_ROOT/secrets/pane-release/AuthKey_LG3BDKV6WC.p8"
export NOTARY_KEY_ID="$(tr -d '[:space:]' < "$REPO_ROOT/secrets/pane-release/NOTARY_KEY_ID.txt")"
export NOTARY_ISSUER="$(tr -d '[:space:]' < "$REPO_ROOT/secrets/pane-release/NOTARY_ISSUER.txt")"
export SPARKLE_PRIVATE_KEY="$(cat "$REPO_ROOT/secrets/pane-release/sparkle-private.b64")"
export PANE_BUNDLED_MANIFEST_PATH="$REPO_ROOT/updates/extensions/bundled-manifest.xml"

TAG="browser/v$VERSION"
DMG="releases/$VERSION/Pane_v${VERSION}_arm64.dmg"

# ------------------------------------------------------------------
# STEP A: If notarytool died without stapling, re-submit and staple.
# Only run this if the DMG does NOT yet exist.
# ------------------------------------------------------------------
if [ ! -f "$DMG" ]; then
  echo "DMG not found — running package_macos + sparkle_sign (app is already signed)."
  uv run browseros build --modules package_macos,sparkle_sign \
    --arch arm64 --build-type release --chromium-src /Users/abhishek/chromium/src
fi

# ------------------------------------------------------------------
# STEP B: Verify Gatekeeper cleanliness
# ------------------------------------------------------------------
APP="/Users/abhishek/chromium/src/out/Default_arm64/Pane.app"
echo ""
echo "=== codesign deep verify ==="
codesign --verify --deep --strict "$APP"

echo ""
echo "=== spctl ==="
spctl -a -vv "$APP"

echo ""
echo "=== stapler validate (app - ticket stapled from accepted submission) ==="
xcrun stapler validate "$APP"

# ------------------------------------------------------------------
# STEP C: Tag + GitHub release + upload
# ------------------------------------------------------------------
echo ""
echo "=== Tagging ==="
cd "$REPO_ROOT"
git tag -a "$TAG" -m "browser v$VERSION"
git push origin "$TAG"

gh release create "$TAG" \
  --repo abhishek-verma/Pane \
  --title "Pane Browser - v$VERSION" \
  --notes "Signed release." || true

gh release upload "$TAG" \
  "packages/browseros/$DMG" \
  "packages/browseros/releases/$VERSION/pane-browser-release-metadata.json" \
  --clobber

# ------------------------------------------------------------------
# STEP D: Appcast
# ------------------------------------------------------------------
cd packages/browseros
uv run browseros ota browser appcast \
  --version "$VERSION" --tag "$TAG" \
  --output-dir "$REPO_ROOT/updates/browser"

cd "$REPO_ROOT"
packages/browseros-agent/scripts/release/commit-updates-via-pr.sh \
  main "chore/browser-appcast-v${VERSION}" \
  "chore: update browser appcasts for v${VERSION}" \
  updates/browser/appcast.xml \
  updates/browser/appcast-x86_64.xml \
  updates/browser/appcast-win.xml \
  updates/browser/appcast-win-arm64.xml

# ------------------------------------------------------------------
# STEP E: Homebrew cask
# ------------------------------------------------------------------
echo ""
echo "=== Updating Homebrew tap ==="
"$REPO_ROOT/packages/browseros-agent/scripts/release/update-brew-cask.sh" "$VERSION"

echo ""
echo "✅ Release v$VERSION complete."
