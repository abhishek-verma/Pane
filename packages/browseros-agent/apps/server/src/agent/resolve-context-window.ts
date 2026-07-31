/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Catalog corrections for models whose stored/template context windows lag
 * the provider's real limits. Keeps compaction from over-pruning (which can
 * break thinking-model tool turns) when the client still has a stale value.
 */

const KNOWN_MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-v4-flash': 1_000_000,
  'deepseek-v4-pro': 1_000_000,
}

export function resolveContextWindowSize(
  model: string,
  contextWindowSize: number | undefined,
  fallback: number,
): number {
  const known = KNOWN_MODEL_CONTEXT_WINDOWS[model.toLowerCase()]
  if (known != null) return known
  return contextWindowSize ?? fallback
}
