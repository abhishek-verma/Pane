#!/usr/bin/env bash
# Update the homebrew-pane tap cask to the just-shipped DMG version.
#
# Reads SHA256 from the GitHub release asset digest (set by GitHub when the
# DMG is uploaded via gh release upload). The release must already be published
# before calling this script.
#
# Usage:
#   update-brew-cask.sh <version>
#   e.g. update-brew-cask.sh 0.47.0.70
#
# Requires: gh CLI authenticated to abhishek-verma.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <version>   e.g. $0 0.47.0.70" >&2
  exit 2
fi

VERSION="$1"
TAG="v$VERSION"
TAP_REPO="abhishek-verma/homebrew-pane"
PANE_REPO="${GITHUB_REPOSITORY:-abhishek-verma/Pane}"
FILE_PATH="Casks/pane.rb"

if ! command -v gh >/dev/null 2>&1; then
  echo "::error::gh CLI required" >&2
  exit 1
fi

echo "=== Updating homebrew-pane cask for $TAG ==="

# Read SHA256 from the GitHub release asset digest field.
SHA256=$(gh release view "$TAG" \
  --repo "$PANE_REPO" \
  --json assets \
  --jq '.assets[] | select(.name | endswith("arm64.dmg")) | .digest' \
  | sed 's/sha256://')

# Reject empty, the literal string "null" (jq output when field is absent),
# and anything that isn't a 64-char lowercase hex string.
if [ -z "$SHA256" ] || [ "$SHA256" = "null" ] || ! echo "$SHA256" | grep -qE '^[0-9a-f]{64}$'; then
  echo "::error::Could not read a valid SHA256 digest for the arm64 DMG in release $TAG on $PANE_REPO" >&2
  echo "  Got: '${SHA256:-<empty>}'" >&2
  echo "  Make sure the DMG has been uploaded and the release asset has a sha256 digest." >&2
  exit 1
fi

echo "  version : $VERSION"
echo "  sha256  : $SHA256"

CASK_CONTENT="cask \"pane\" do
  version \"${VERSION}\"

  on_arm do
    url \"https://github.com/abhishek-verma/Pane/releases/download/v\#{version}/Pane_v\#{version}_arm64.dmg\"
    sha256 \"${SHA256}\"
  end

  name \"Pane\"
  desc \"Browser with a built-in personal agent\"
  homepage \"https://github.com/abhishek-verma/Pane\"

  livecheck do
    url :url
    strategy :github_latest
  end

  app \"Pane.app\"

  zap trash: [
    \"~/Library/Application Support/Pane\",
    \"~/.browseros\",
    \"~/.browseros-dev\",
  ]
end
"

# Fetch the current file's blob SHA (required by GitHub Contents API for updates).
FILE_SHA=$(gh api "repos/$TAP_REPO/contents/$FILE_PATH" --jq '.sha' 2>/dev/null || echo "")

ENCODED=$(printf '%s' "$CASK_CONTENT" | base64)

if [ -z "$FILE_SHA" ]; then
  gh api "repos/$TAP_REPO/contents/$FILE_PATH" \
    --method PUT \
    --field message="chore: update pane cask to v${VERSION}" \
    --field content="$ENCODED"
else
  gh api "repos/$TAP_REPO/contents/$FILE_PATH" \
    --method PUT \
    --field message="chore: update pane cask to v${VERSION}" \
    --field content="$ENCODED" \
    --field sha="$FILE_SHA"
fi

echo "✅ homebrew-pane cask updated to v${VERSION}"
