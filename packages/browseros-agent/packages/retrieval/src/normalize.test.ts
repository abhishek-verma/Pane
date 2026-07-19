/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { contentTokens, normalizeQuery } from './normalize'

describe('normalizeQuery', () => {
  it('drops stopwords and keeps content tokens', () => {
    const n = normalizeQuery('what interviews are coming up?')
    expect(n.tokens).toContain('interviews')
    expect(n.tokens).toContain('coming')
    expect(n.tokens).toContain('up')
    expect(n.tokens).not.toContain('what')
    expect(n.tokens).not.toContain('are')
    expect(n.hints).toContain('temporal')
  })

  it('keeps upcoming as a content token', () => {
    expect(contentTokens('upcoming interviews')).toEqual([
      'upcoming',
      'interviews',
    ])
  })
})
