import { describe, expect, it } from 'bun:test'
import { shouldShowFirstSkillMilestone } from './use-first-skill-milestone'

describe('shouldShowFirstSkillMilestone', () => {
  it('is false with zero skills learned', () => {
    expect(shouldShowFirstSkillMilestone(0, false)).toBe(false)
  })

  it('is true with at least one skill and not yet seen', () => {
    expect(shouldShowFirstSkillMilestone(1, false)).toBe(true)
  })

  it('is false once already seen, regardless of skill count', () => {
    expect(shouldShowFirstSkillMilestone(3, true)).toBe(false)
  })
})
