/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Hono } from 'hono'

import { runTracker } from '../../agent/run-tracker'

interface ShutdownRouteConfig {
  onShutdown: () => void
}

export function createShutdownRoute(config: ShutdownRouteConfig) {
  return new Hono().post('/', async (c) => {
    // Return early to close the request, but schedule the shutdown after drain
    setTimeout(async () => {
      try {
        await runTracker.drain()
      } finally {
        config.onShutdown()
      }
    }, 0)
    return c.json({ status: 'ok' })
  })
}
