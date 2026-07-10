#!/usr/bin/env bash
# Stage Pane server/claw resource bundles for local browser builds (no BrowserOS R2).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
AGENT="$ROOT/packages/browseros-agent"
BROWSEROS="$ROOT/packages/browseros"
TARGET="${1:-darwin-arm64}"

SERVER_ZIP="$AGENT/dist/prod/server/browseros-server-resources-${TARGET}.zip"
CLAW_ZIP="$AGENT/dist/prod/claw-server/browseros-claw-server-resources-${TARGET}.zip"

for zip in "$SERVER_ZIP" "$CLAW_ZIP"; do
  if [ ! -f "$zip" ]; then
    echo "Missing $zip — run:" >&2
    echo "  cd packages/browseros-agent && PANE_BUILD=true bun scripts/build/server.ts --target=${TARGET} --no-upload --ci" >&2
    echo "  cd packages/browseros-agent && PANE_BUILD=true bun scripts/build/claw-server.ts --target=${TARGET} --no-upload --ci" >&2
    exit 1
  fi
done

cd "$BROWSEROS"
uv run python - <<PY
from pathlib import Path
from build.modules.storage.download import extract_artifact_zip

root = Path("$BROWSEROS")
agent = Path("$AGENT")
target = "$TARGET"

pairs = [
    (
        agent / "dist/prod/server" / f"browseros-server-resources-{target}.zip",
        root / "resources/binaries/browseros_server" / target,
    ),
    (
        agent / "dist/prod/claw-server" / f"browseros-claw-server-resources-{target}.zip",
        root / "resources/binaries/browseros_claw_server" / target,
    ),
]

for archive, destination in pairs:
    if destination.exists():
        import shutil
        shutil.rmtree(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    extract_artifact_zip(archive, destination)
    print(f"Staged {destination}")
PY
