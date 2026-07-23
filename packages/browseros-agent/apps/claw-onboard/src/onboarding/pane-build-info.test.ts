import { describe, expect, it } from 'bun:test'
import { onboardingPlatformLabel } from './pane-build-info'

describe('onboardingPlatformLabel', () => {
  it('detects macOS, Windows, and Linux user agents', () => {
    expect(
      onboardingPlatformLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X)'),
    ).toBe('macOS')
    expect(
      onboardingPlatformLabel('Mozilla/5.0 (Windows NT 10.0; Win64)'),
    ).toBe('Windows')
    expect(onboardingPlatformLabel('Mozilla/5.0 (X11; Linux x86_64)')).toBe(
      'Linux',
    )
  })
})
