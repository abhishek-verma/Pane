import { describe, expect, it } from 'bun:test'
import { shouldShowFirstSkillMilestone } from './use-first-skill-milestone'

describe('shouldShowFirstSkillMilestone', () => {
  it('is false with zero skills learned', () => {
    expect(shouldShowFirstSkillMilestone(0, 0, false)).toBe(false)
  })

  it('is true when the baseline was 0 and at least one skill is now learned', () => {
    expect(shouldShowFirstSkillMilestone(1, 0, false)).toBe(true)
  })

  it('is false once already seen, regardless of skill count', () => {
    expect(shouldShowFirstSkillMilestone(3, 0, true)).toBe(false)
  })

  it('is false when the baseline already had skills — not a "just learned" transition', () => {
    expect(shouldShowFirstSkillMilestone(3, 2, false)).toBe(false)
  })
})
