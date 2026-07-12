/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_DISK_PAUSE_BYTES,
  getCapturePausedReason,
  setCapturePausedReason,
} from '../../src/capture/performance'

describe('capture performance', () => {
  it('tracks pause reasons', () => {
    setCapturePausedReason('battery')
    expect(getCapturePausedReason()).toBe('battery')
    setCapturePausedReason(null)
    expect(getCapturePausedReason()).toBeNull()
  })

  it('uses a 5GB disk pause threshold by default', () => {
    expect(DEFAULT_DISK_PAUSE_BYTES).toBe(5 * 1024 * 1024 * 1024)
  })
})
