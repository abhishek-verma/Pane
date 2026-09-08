import { describe, expect, test } from 'bun:test'
import { piFavicon, piPageTitle } from './page-metadata'
import { titleForAppPath } from './RouteDocumentTitle'

describe('tab identity', () => {
  test('puts page names first and avoids repeating the site name', () => {
    expect(piPageTitle(' Interview prep ', ' Job search ')).toBe(
      'Interview prep · Job search · Pane',
    )
    expect(piPageTitle('Job search', 'Job search')).toBe('Job search · Pane')
    expect(piPageTitle(undefined, 'Job search')).toBe('Job search · Pane')
    expect(piPageTitle('Weekly plan', 'Temp')).toBe('Weekly plan · Temp · Pane')
  })

  test('names shell routes and leaves data-driven PI titles to their screens', () => {
    expect(titleForAppPath('/home')).toBe('Home')
    expect(titleForAppPath('/pi/library')).toBe('Library · Pane')
    expect(titleForAppPath('/tasks')).toBe('Tasks · Pane')
    expect(titleForAppPath('/meetings')).toBe('Meetings · Pane')
    expect(titleForAppPath('/settings/memory')).toBe('Memory · Pane')
    for (const path of [
      '/pi/sites/jobs',
      '/pi/sites/jobs/pages/prep',
      '/pi/sites/jobs/entities/company',
      '/pi/temp/draft',
    ]) {
      expect(titleForAppPath(path)).toBeNull()
    }
  })

  test('keeps site icons stable and distinguishes sites and temporary pages', () => {
    const jobs = piFavicon('jobs', 'Job search')
    expect(piFavicon('jobs', 'Job search')).toBe(jobs)
    expect(piFavicon('reading', 'Reading list')).not.toBe(jobs)
    expect(piFavicon('jobs', 'Job search', true)).not.toBe(jobs)
    expect(decodeURIComponent(jobs)).toContain('>JS</text>')
  })

  test('escapes page names in SVG and preserves Unicode initials', () => {
    const svg = decodeURIComponent(piFavicon('special', '<script> &bad'))
    expect(svg).toContain('>&#60;&#38;</text>')
    expect(svg).not.toContain('<script>')
    expect(decodeURIComponent(piFavicon('unicode', '日本 語'))).toContain(
      '>日語</text>',
    )
  })
})
