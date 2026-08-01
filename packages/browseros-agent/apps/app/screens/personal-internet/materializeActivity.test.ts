/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import type { MaterializeActivitySnapshot } from './materializeActivity'

describe('materializeActivity types', () => {
  it('accepts slim activity API shape', () => {
    const snap: MaterializeActivitySnapshot = {
      lines: [{ kind: 'tool', text: 'Updating page…' }],
      toolWaiting: false,
      lastToolName: 'pi_page_patch',
    }
    expect(snap.lines).toHaveLength(1)
  })
})
