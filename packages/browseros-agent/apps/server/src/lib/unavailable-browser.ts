/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Disconnected CDP/browser facade for --server-only keep-alive mode.
 * HTTP + digest + reach work; browser tools fail with a clear skip reason.
 */

import type { CdpBackend } from '@browseros/browser-core/backends/types'
import { Browser } from '@browseros/browser-core/browser'
import {
  createProtocolApi,
  type RawOn,
  type RawSend,
} from '@browseros/cdp-protocol/create-api'
import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import { browserMissingSkipReason } from '../scheduler/keep-alive'

function unavailable(): Promise<never> {
  return Promise.reject(new Error(browserMissingSkipReason()))
}

/** CDP backend that never connects and rejects all protocol calls. */
export function createDisconnectedCdpBackend(): CdpBackend {
  const rawSend: RawSend = () => unavailable()
  const rawOn: RawOn = () => () => {}
  const api = createProtocolApi(rawSend, rawOn)

  const backend = Object.assign(api, {
    connect: async () => {
      // Intentionally no-op — server-only mode has no Chromium.
    },
    disconnect: async () => {},
    isConnected: () => false,
    connectionEpoch: () => 0,
    getTargets: async () => [],
    session: (_sessionId: string): ProtocolApi => api,
    rawSend: (
      _method: string,
      _params?: Record<string, unknown>,
      _sessionId?: string,
    ) => unavailable(),
    rawSendJson: (_method: string, _paramsJson: string, _sessionId?: string) =>
      unavailable(),
    onSessionEvent: () => () => {},
  }) as CdpBackend

  return backend
}

/** Browser facade for keep-alive / server-only (no CDP). */
export function createUnavailableBrowser(): Browser {
  return new Browser(createDisconnectedCdpBackend())
}
