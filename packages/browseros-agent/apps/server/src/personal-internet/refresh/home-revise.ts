/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Kind D / home continuity revise — local merge (no LLM required for ship).
 */

import { buildPiHomeProjection } from '../home-projection'
import type { PiContinuityBlock } from '../types'

/** Rebuild Today continuity from canonical approvals + doorway urgencies. */
export async function reviseHomeContinuityLocal(): Promise<{
  blocks: PiContinuityBlock[]
}> {
  const projection = await buildPiHomeProjection()
  return { blocks: projection.continuity.slice(0, 5) }
}

/** Manual Today refresh: rebuild from current canonical facts.
 *
 * Dismissals are user intent and must survive refresh; an explicit removal
 * should not reappear merely because Home happened to refresh.
 */
export async function refreshHomeToday(): Promise<{
  blocks: PiContinuityBlock[]
}> {
  return reviseHomeContinuityLocal()
}
