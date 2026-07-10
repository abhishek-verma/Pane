#!/usr/bin/env bash
# Build an unsigned Pane browser for GitHub Releases (macOS arm64 by default).
#
# Prereqs:
#   - CHROMIUM_SRC in packages/browseros/.env or environment
#   - macOS with Xcode CLI tools (for DMG packaging)
#   - SPARKLE_PRIVATE_KEY optional (for auto-update appcast metadata)
#
# Usage:
#   ./scripts/release/build-unsigned-browser.sh
#   ./scripts/release/build-unsigned-browser.sh --platform linux
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
BROWSEROS="$ROOT/packages/browseros"
PLATFORM="macos"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --platform)
      PLATFORM="${2:-}"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage: build-unsigned-browser.sh [--platform macos|linux]

Builds an unsigned release artifact for upload to GitHub Releases.
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [ -f "$BROWSEROS/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$BROWSEROS/.env"
  set +a
fi

if [ -z "${CHROMIUM_SRC:-}" ]; then
  echo "CHROMIUM_SRC is not set. Add it to packages/browseros/.env" >&2
  echo "See docs/contributing.mdx (Browser Development) for Chromium checkout steps." >&2
  exit 1
fi

if [ ! -d "$CHROMIUM_SRC" ]; then
  echo "CHROMIUM_SRC directory not found: $CHROMIUM_SRC" >&2
  exit 1
fi

case "$PLATFORM" in
  macos)
    CONFIG="build/config/release.macos.arm64.unsigned.yaml"
    ;;
  linux)
    CONFIG="build/config/release.linux.noupload.yaml"
    ;;
  *)
    echo "Unsupported platform: $PLATFORM (use macos or linux)" >&2
    exit 2
    ;;
esac

cd "$BROWSEROS"
"$ROOT/packages/browseros-agent/scripts/release/stage-pane-browser-resources.sh" darwin-arm64
uv sync

# gn/ninja need the full Xcode SDK, not Command Line Tools alone.
if [ -d /Applications/Xcode.app/Contents/Developer ]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

uv run browseros build --config "$CONFIG" --chromium-src "$CHROMIUM_SRC"

VERSION="$(python3 - <<'PY'
from pathlib import Path
parts = {}
for line in Path("resources/BROWSEROS_VERSION").read_text().splitlines():
    key, value = line.split("=")
    parts[key.strip()] = value.strip()
major = int(parts["BROWSEROS_MAJOR"])
minor = int(parts["BROWSEROS_MINOR"])
build = int(parts["BROWSEROS_BUILD"])
patch = int(parts["BROWSEROS_PATCH"])
if patch != 0:
    print(f"{major}.{minor}.{build}.{patch}")
elif build != 0:
    print(f"{major}.{minor}.{build}")
else:
    print(f"{major}.{minor}.0")
PY
)"

RELEASE_DIR="$BROWSEROS/releases"
if [ -d "$RELEASE_DIR/$VERSION" ]; then
  echo ""
  echo "Build complete. Artifacts:"
  ls -lh "$RELEASE_DIR/$VERSION"
  echo ""
  echo "Next:"
  echo "  git tag -a browser/v$VERSION -m \"browser v$VERSION\""
  echo "  git push origin browser/v$VERSION"
  echo "  $ROOT/packages/browseros-agent/scripts/release/upload-browser-release.sh \\"
  echo "    browser/v$VERSION $RELEASE_DIR/$VERSION/*"
else
  echo "Build finished but release directory not found at $RELEASE_DIR/$VERSION" >&2
  exit 1
fi
