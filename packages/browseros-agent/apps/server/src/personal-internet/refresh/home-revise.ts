/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Kind D / home continuity revise — local merge (no LLM required for ship).
 */

import { buildPiHomeProjection } from '../home-projection'
import { writeHomeContinuity } from '../store'
import type { PiContinuityBlock } from '../types'

/** Rebuild Today continuity from approvals + doorway urgencies; persist. */
export async function reviseHomeContinuityLocal(): Promise<{
  blocks: PiContinuityBlock[]
}> {
  // Projection already merges live approvals and drops resolved approval-*
  // ghosts from the persisted file.
  const projection = await buildPiHomeProjection()
  const blocks = projection.continuity.slice(0, 5)
  await writeHomeContinuity(blocks)
  return { blocks }
}
