#!/usr/bin/env bash
# Wait for unsigned browser build to finish, then tag, upload, and refresh appcast.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
BROWSEROS="$ROOT/packages/browseros"
LOG="$BROWSEROS/logs/unsigned-release-build.log"
VERSION="$(python3 - <<'PY'
from pathlib import Path
parts = {}
for line in Path("/Users/abhishek/workspace/Pane/packages/browseros/resources/BROWSEROS_VERSION").read_text().splitlines():
    key, value = line.split("=")
    parts[key.strip()] = value.strip()
major = int(parts["BROWSEROS_MAJOR"])
minor = int(parts["BROWSEROS_MINOR"])
build = int(parts["BROWSEROS_BUILD"])
patch = int(parts["BROWSEROS_PATCH"])
print(f"{major}.{minor}.{build}.{patch}" if patch else f"{major}.{minor}.{build}")
PY
)"
TAG="browser/v$VERSION"
REPO="${GITHUB_REPOSITORY:-abhishek-verma/Pane}"
RELEASE_DIR="$BROWSEROS/releases/$VERSION"

echo "=== Waiting for build success in $LOG (version $VERSION) ==="

while true; do
  if grep -q "Pane unsigned browser build finished.*exit=0" "$LOG" 2>/dev/null; then
    echo "Build succeeded."
    break
  fi
  if grep -q "Pane unsigned browser build finished.*exit=[1-9]" "$LOG" 2>/dev/null; then
    echo "Build failed. See $LOG" >&2
    tail -40 "$LOG" >&2
    exit 1
  fi
  sleep 120
done

if [ ! -d "$RELEASE_DIR" ]; then
  echo "Release directory missing: $RELEASE_DIR" >&2
  exit 1
fi

DMG="$(find "$RELEASE_DIR" -maxdepth 1 -name "Pane_v${VERSION}_arm64.dmg" | head -1)"
METADATA="$RELEASE_DIR/pane-browser-release-metadata.json"
if [ -z "$DMG" ] || [ ! -f "$METADATA" ]; then
  echo "Missing DMG or metadata in $RELEASE_DIR" >&2
  ls -la "$RELEASE_DIR" >&2
  exit 1
fi

cd "$ROOT"

if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  git tag -a "$TAG" -m "browser v$VERSION"
fi

if ! git ls-remote --exit-code origin "refs/tags/$TAG" >/dev/null 2>&1; then
  git push origin "$TAG"
  echo "Pushed tag $TAG"
else
  echo "Tag $TAG already on remote"
fi

echo "Waiting for GitHub release $TAG..."
for _ in $(seq 1 60); do
  if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
    break
  fi
  sleep 10
done

if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Release $TAG not found after tag push; creating manually" >&2
  gh release create "$TAG" --repo "$REPO" --title "Pane Browser - v$VERSION" \
    --notes "Toolbar cleanup and Pane Chat removal release."
fi

"$ROOT/packages/browseros-agent/scripts/release/upload-browser-release.sh" \
  "$TAG" "$DMG" "$METADATA"

echo "Triggering appcast workflow..."
gh workflow run release-browser.yml --repo "$REPO" -f "tag=$TAG"

echo "=== Published $TAG ==="
echo "DMG: $DMG"
