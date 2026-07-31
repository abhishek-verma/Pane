/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { PI_MERMAID_RENDER_ENABLED } from './mermaid-render-enabled'

describe('PI_MERMAID_RENDER_ENABLED', () => {
  it('defaults to enabled (kill switch off)', () => {
    expect(PI_MERMAID_RENDER_ENABLED).toBe(true)
  })
})
