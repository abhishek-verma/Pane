/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test } from 'bun:test'
import {
  entityHref,
  entityRoute,
  hrefToRoute,
  libraryHref,
  pageHref,
  pageRoute,
  parsePiHref,
  parsePiRoute,
  routeToHref,
  siteHref,
  siteRoute,
  tempHref,
  tempRoute,
} from '../../src/personal-internet/pi-href'

describe('pi-href', () => {
  test('round-trips site / page / entity / temp / library', () => {
    for (const route of [
      siteRoute('s1'),
      pageRoute('s1', 'p1'),
      entityRoute('s1', 'Acme Corp'),
      tempRoute('t1'),
      '#/pi/library',
    ]) {
      const href = routeToHref(route)
      expect(href).toBeTruthy()
      expect(hrefToRoute(href!)).toBe(route)
    }
  })

  test('canonical href builders', () => {
    expect(siteHref('s1')).toBe('pi://sites/s1')
    expect(pageHref('s1', 'p1')).toBe('pi://sites/s1/pages/p1')
    expect(entityHref('s1', 'Acme Corp')).toBe(
      'pi://sites/s1/entities/Acme%20Corp',
    )
    expect(tempHref('t1')).toBe('pi://temp/t1')
    expect(libraryHref()).toBe('pi://library')
  })

  test('parsePiHref', () => {
    expect(parsePiHref('pi://sites/s1/pages/p1')).toEqual({
      kind: 'page',
      siteId: 's1',
      pageId: 'p1',
    })
    expect(parsePiHref('pi://library')).toEqual({ kind: 'library' })
    expect(parsePiHref('https://example.com')).toBeNull()
  })

  test('parsePiRoute accepts hash and path forms', () => {
    expect(parsePiRoute('#/pi/sites/s1')).toEqual({
      kind: 'site',
      siteId: 's1',
    })
    expect(parsePiRoute('/pi/temp/t1')).toEqual({
      kind: 'temp',
      tempId: 't1',
    })
  })
})
