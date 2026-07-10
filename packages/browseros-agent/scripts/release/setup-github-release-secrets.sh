#!/usr/bin/env bash
# Create the release-core environment and upload verified secrets to GitHub.
#
# Prereq: run verify_release_secrets.py with secrets exported, or pass key files:
#
#   export SPARKLE_PRIVATE_KEY="$(cat sparkle-ed25519-private.key)"
#   export AGENT_EXTENSION_PRIVATE_KEY="$(cat agent-extension.pem)"
#   ./scripts/release/setup-github-release-secrets.sh
#
# Or:
#   ./scripts/release/setup-github-release-secrets.sh \
#     --sparkle sparkle-ed25519-private.key \
#     --agent agent-extension.pem \
#     --claw claw-extension.pem
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
REPO="${GITHUB_REPOSITORY:-abhishek-verma/Pane}"

SPARKLE_FILE=""
AGENT_FILE=""
CLAW_FILE=""
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: setup-github-release-secrets.sh [options]

Uploads repository secrets for Pane release workflows after local verification.

Options:
  --sparkle PATH   File with Sparkle Ed25519 private key (32/64-byte base64 or raw)
  --agent PATH     PEM private key for agent extension (bflpfmnm...)
  --claw PATH      PEM private key for claw extension (optional)
  --repo OWNER/NAME  GitHub repo (default: abhishek-verma/Pane)
  --dry-run        Verify only; do not call gh secret set
  -h, --help

Secrets can also be supplied via environment variables:
  SPARKLE_PRIVATE_KEY
  AGENT_EXTENSION_PRIVATE_KEY
  CLAW_EXTENSION_PRIVATE_KEY

Repository secrets are used (not environment secrets) so tag-triggered
releases work without manual approval. The release-core *environment* is
created for workflow_dispatch approval only.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --sparkle) SPARKLE_FILE="${2:-}"; shift 2 ;;
    --agent) AGENT_FILE="${2:-}"; shift 2 ;;
    --claw) CLAW_FILE="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -n "$SPARKLE_FILE" ]; then
  export SPARKLE_PRIVATE_KEY="$(cat "$SPARKLE_FILE")"
fi
if [ -n "$AGENT_FILE" ]; then
  export AGENT_EXTENSION_PRIVATE_KEY="$(cat "$AGENT_FILE")"
fi
if [ -n "$CLAW_FILE" ]; then
  export CLAW_EXTENSION_PRIVATE_KEY="$(cat "$CLAW_FILE")"
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required: https://cli.github.com" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required for extension key verification" >&2
  exit 1
fi

echo "Verifying secrets locally..."
python3 "$ROOT/packages/browseros-agent/scripts/release/verify_release_secrets.py"

if [ "$DRY_RUN" = true ]; then
  echo "Dry run: secrets valid, skipping gh secret set"
  exit 0
fi

echo "Ensuring GitHub environment release-core exists (manual dispatch gate)..."
gh api --method PUT "repos/${REPO}/environments/release-core" \
  -f wait_timer=0 >/dev/null 2>&1 || true

set_secret() {
  local name="$1"
  local file="$2"
  if [ ! -f "$file" ]; then
    return 0
  fi
  if [[ "$name" == "SPARKLE_PRIVATE_KEY" ]]; then
    cat "$file" | gh secret set "$name" --repo "$REPO"
  else
    gh secret set "$name" --repo "$REPO" < "$file"
  fi
  echo "Set repository secret: $name"
}

if [ -n "$SPARKLE_FILE" ]; then
  set_secret SPARKLE_PRIVATE_KEY "$SPARKLE_FILE"
elif [ -n "${SPARKLE_PRIVATE_KEY:-}" ]; then
  gh secret set SPARKLE_PRIVATE_KEY --repo "$REPO" <<< "$SPARKLE_PRIVATE_KEY"
  echo "Set repository secret: SPARKLE_PRIVATE_KEY"
fi

if [ -n "$AGENT_FILE" ]; then
  set_secret AGENT_EXTENSION_PRIVATE_KEY "$AGENT_FILE"
elif [ -n "${AGENT_EXTENSION_PRIVATE_KEY:-}" ]; then
  gh secret set AGENT_EXTENSION_PRIVATE_KEY --repo "$REPO" <<< "$AGENT_EXTENSION_PRIVATE_KEY"
  echo "Set repository secret: AGENT_EXTENSION_PRIVATE_KEY"
fi

if [ -n "$CLAW_FILE" ]; then
  set_secret CLAW_EXTENSION_PRIVATE_KEY "$CLAW_FILE"
elif [ -n "${CLAW_EXTENSION_PRIVATE_KEY:-}" ]; then
  gh secret set CLAW_EXTENSION_PRIVATE_KEY --repo "$REPO" <<< "$CLAW_EXTENSION_PRIVATE_KEY"
  echo "Set repository secret: CLAW_EXTENSION_PRIVATE_KEY"
fi

echo ""
echo "Done. Repository secrets on ${REPO}:"
gh secret list --repo "$REPO" | rg 'SPARKLE|EXTENSION' || true
echo ""
echo "Next: tag a release (e.g. agent-extension/v0.0.100) or workflow_dispatch from Actions."
