#!/usr/bin/env bash
# Upload signed browser artifacts from a local build to a GitHub browser release.
#
# Usage:
#   ./scripts/release/upload-browser-release.sh browser/v0.47.0.1 \
#     packages/browseros/dist/BrowserOS_v0.47.0.1_arm64.dmg \
#     packages/browseros/dist/pane-browser-release-metadata.json
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <browser-tag> <artifact> [artifact...]" >&2
  exit 2
fi

TAG="$1"
shift
REPO="${GITHUB_REPOSITORY:-abhishek-verma/Pane}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required" >&2
  exit 1
fi

if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Release $TAG does not exist on $REPO. Push the tag first." >&2
  exit 1
fi

gh release upload "$TAG" --repo "$REPO" "$@" --clobber
echo "Uploaded $# artifact(s) to $REPO $TAG"
