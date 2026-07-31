/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Cheap client-side Mermaid budget checks mirrored from server PI_LIMITS.
 */

import { PI_LIMITS } from '@browseros/shared/constants/limits'

export { PI_LIMITS }

/** Rough edge count: mermaid arrow operators. */
export function countMermaidEdges(source: string): number {
  const re =
    /(?:-->|---|-\.-|==>|==|~.>~|-\.->|===>|<-->|<--|<===|o--|x--|-->>)/g
  let count = 0
  while (re.exec(source)) count++
  return count
}

/** Mermaid %%{init: ...}%% directives that try to raise secure limits. */
export function hasForbiddenMermaidDirective(source: string): boolean {
  if (!/%%\s*\{\s*init\s*:/i.test(source)) return false
  return /maxTextSize|maxEdges|securityLevel|startOnLoad/i.test(source)
}

export function assertMermaidSourceBudget(source: string): void {
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('mermaid source required')
  }
  if (source.length > PI_LIMITS.MAX_MERMAID_CHARS) {
    throw new Error(`mermaid exceeds ${PI_LIMITS.MAX_MERMAID_CHARS} chars`)
  }
  if (hasForbiddenMermaidDirective(source)) {
    throw new Error(
      'mermaid init directives that override limits are not allowed',
    )
  }
  if (countMermaidEdges(source) > PI_LIMITS.MAX_MERMAID_EDGES) {
    throw new Error(`mermaid exceeds ${PI_LIMITS.MAX_MERMAID_EDGES} edges`)
  }
  if (/<svg|<script|javascript:/i.test(source)) {
    throw new Error('unsafe mermaid source')
  }
}
