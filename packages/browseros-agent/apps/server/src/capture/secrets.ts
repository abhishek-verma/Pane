/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getReachSecret, setReachSecret } from '../reach/secrets'

const TRANSPORT = 'capture' as const

export type CaptureAsrProvider = 'openai' | 'deepgram'

export function setCaptureAsrSecret(
  provider: CaptureAsrProvider,
  apiKey: string,
): void {
  setReachSecret(TRANSPORT, `${provider}_api_key`, apiKey)
}

export function getCaptureAsrSecret(
  provider: CaptureAsrProvider,
): string | null {
  return getReachSecret(TRANSPORT, `${provider}_api_key`)
}
