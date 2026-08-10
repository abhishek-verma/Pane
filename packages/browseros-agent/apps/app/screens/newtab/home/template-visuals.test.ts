import { describe, expect, it } from 'bun:test'
import { Briefcase, Globe } from 'lucide-react'
import { templateIcon } from './template-visuals'

describe('templateIcon', () => {
  it('maps a known template id to its icon', () => {
    expect(templateIcon('job-search')).toBe(Briefcase)
  })

  it('falls back to a generic icon for unknown ids', () => {
    expect(templateIcon('something-unrecognized')).toBe(Globe)
  })
})
