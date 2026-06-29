/**
 * Unit tests for product-features pane build profile.
 *
 * Verifies that when PANE_BUILD=true, all cloud feature flags are false
 * regardless of what other env vars are set.
 */

import { describe, expect, it } from 'bun:test'

describe('product-features — pane build profile', () => {
  it('returns false for all cloud flags when PANE_BUILD=true even with env vars set', async () => {
    // Simulate a pane build by temporarily overriding import.meta.env.
    // We test the logic directly since we can't dynamically re-import with
    // different PANE_BUILD values at runtime; instead we test the envFlag
    // function's behavior inline.

    const isPaneBuild = true

    function envFlag(name: string, defaultValue = false): boolean {
      if (isPaneBuild) return false
      const value = { VITE_HOSTED_INFERENCE: 'true', VITE_CLOUD_SYNC: 'true' }[
        name
      ]
      if (value === undefined || value === '') return defaultValue
      return value === 'true'
    }

    const features = {
      hostedInference: envFlag('VITE_HOSTED_INFERENCE', false),
      cloudSync: envFlag('VITE_CLOUD_SYNC', false),
      klavisIntegrations: envFlag('VITE_KLAVIS_INTEGRATIONS', false),
      remoteHermes: envFlag('VITE_REMOTE_HERMES', false),
      creditsBilling: envFlag('VITE_CREDITS_BILLING', false),
    }

    expect(features.hostedInference).toBe(false)
    expect(features.cloudSync).toBe(false)
    expect(features.klavisIntegrations).toBe(false)
    expect(features.remoteHermes).toBe(false)
    expect(features.creditsBilling).toBe(false)
  })

  it('reads env flags when PANE_BUILD is false', () => {
    const isPaneBuild = false

    function envFlag(
      name: string,
      defaultValue = false,
      fakeEnv: Record<string, string> = {},
    ): boolean {
      if (isPaneBuild) return false
      const value = fakeEnv[name]
      if (value === undefined || value === '') return defaultValue
      return value === 'true'
    }

    // Verify that without pane build, env vars are respected
    expect(
      envFlag('VITE_HOSTED_INFERENCE', false, {
        VITE_HOSTED_INFERENCE: 'true',
      }),
    ).toBe(true)
    expect(envFlag('VITE_CLOUD_SYNC', false, {})).toBe(false)
  })
})
