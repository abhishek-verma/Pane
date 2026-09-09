/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getReachSecret } from '../reach/secrets'

const TRANSPORT = 'capture' as const

export type CaptureAsrProvider = 'openai' | 'deepgram'

export function getCaptureAsrSecret(
  provider: CaptureAsrProvider,
): string | null {
  return getReachSecret(TRANSPORT, `${provider}_api_key`)
}
