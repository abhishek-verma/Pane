#!/usr/bin/env bash
# Commit files under updates/ to main via an auto-merge PR.
set -euo pipefail

DEFAULT_BRANCH="${1:?default branch required}"
BRANCH="${2:?branch name required}"
COMMIT_MESSAGE="${3:?commit message required}"
shift 3
FILES=("$@")

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "At least one file path is required" >&2
  exit 2
fi

git fetch origin "$DEFAULT_BRANCH" --no-tags
git checkout -B "$DEFAULT_BRANCH" "origin/$DEFAULT_BRANCH"

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git checkout -b "$BRANCH"
git add "${FILES[@]}"
if git diff --cached --quiet; then
  echo "No manifest changes to commit"
  exit 0
fi
git commit -m "$COMMIT_MESSAGE"
git push --force-with-lease origin "$BRANCH"

gh pr create \
  --title "$COMMIT_MESSAGE" \
  --body "Auto-generated update manifests for Pane releases." \
  --base "$DEFAULT_BRANCH" \
  --head "$BRANCH"

gh pr merge "$BRANCH" --squash --auto || true
