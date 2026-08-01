/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Client types for the slim GET /chat/:id/activity response.
 * Derivation runs on the server — see apps/server materialize-activity.ts.
 */

export type MaterializeActivityLine = {
  kind: 'text' | 'tool' | 'reasoning'
  text: string
}

export type MaterializeActivitySnapshot = {
  lines: MaterializeActivityLine[]
  /** True when the latest tool part is waiting (input-available, no output). */
  toolWaiting: boolean
  lastToolName: string | null
}
