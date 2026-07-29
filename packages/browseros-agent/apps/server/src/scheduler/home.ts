/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Home payload for the new-tab front door — local files + PI projection only.
 * Never calls an LLM.
 */

import { readPromptFiles } from '../memory/files'
import type { PiHomeProjection } from '../personal-internet/types'

export type HomePayload = {
  firstName: string | null
  pi: PiHomeProjection
}

function extractFirstName(userMd: string): string | null {
  const m = userMd.match(/name:\s*([^\n,]+)/i)
  if (!m) return null
  return m[1].trim().split(/\s+/)[0] ?? null
}

export async function loadHome(): Promise<HomePayload> {
  const files = await readPromptFiles()
  const firstName = extractFirstName(files.user)

  let pi: PiHomeProjection
  try {
    const { buildPiHomeProjection, emptyPiHomeProjection } = await import(
      '../personal-internet/home-projection'
    )
    pi = await buildPiHomeProjection()
    if (!pi) pi = emptyPiHomeProjection()
  } catch {
    const { emptyPiHomeProjection } = await import(
      '../personal-internet/home-projection'
    )
    pi = emptyPiHomeProjection()
  }

  return { firstName, pi }
}
