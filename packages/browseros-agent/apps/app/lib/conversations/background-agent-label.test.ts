/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test } from 'bun:test'
import { backgroundAgentLabel } from './background-agent-label'

describe('backgroundAgentLabel', () => {
  test('maps known sources', () => {
    expect(backgroundAgentLabel('pi-harvest')).toBe('Background harvest')
    expect(backgroundAgentLabel('schedule')).toBe('Scheduled agent')
  })

  test('falls back for unknown', () => {
    expect(backgroundAgentLabel(null)).toBe('Background agent')
    expect(backgroundAgentLabel(undefined)).toBe('Background agent')
  })
})
