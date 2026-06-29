#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/png"
mkdir -p "$OUT"

if ! command -v resvg >/dev/null 2>&1; then
  echo "resvg is required. Install with: brew install resvg" >&2
  exit 1
fi

# Square mark + extension icon sizes (Chromium + extension manifests).
SQUARE_SIZES=(16 22 24 32 48 64 128 192 256 512 1024)

# Wordmark viewBox is 78×36 — export height = size, width scales proportionally.
WORDMARK_SIZES=(16 22 24 32 48 64 128 192 256 512 1024)
WORDMARK_ASPECT_W=78
WORDMARK_ASPECT_H=36

export_square_png() {
  local src="$1"
  local base="$2"
  for size in "${SQUARE_SIZES[@]}"; do
    resvg -w "$size" -h "$size" "$src" "$OUT/${base}-${size}.png"
  done
}

export_wordmark_png() {
  local src="$1"
  local base="$2"
  for size in "${WORDMARK_SIZES[@]}"; do
    local width=$(( size * WORDMARK_ASPECT_W / WORDMARK_ASPECT_H ))
    resvg -w "$width" -h "$size" "$src" "$OUT/${base}-${size}.png"
  done
}

export_square_png "$ROOT/pane-mark-black.svg" "pane-mark-black"
export_square_png "$ROOT/pane-mark-white.svg" "pane-mark-white"
export_square_png "$ROOT/pane-extension-icon.svg" "pane-extension-icon"
export_wordmark_png "$ROOT/pane-wordmark.svg" "pane-wordmark"

echo "Exported PNGs to $OUT"
echo "Verifying transparency, proportions, and fill colors..."

swift "$ROOT/verify-pngs.swift" "$OUT"
