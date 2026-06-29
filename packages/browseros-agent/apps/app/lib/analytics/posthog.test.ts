import { describe, expect, it, mock } from 'bun:test'
import posthog from 'posthog-js'
import { initPostHog } from './posthog'
import { telemetryStorage } from './telemetryStorage'

mock.module('../env', () => ({
  env: {
    PANE_BUILD: 'true',
    VITE_PUBLIC_POSTHOG_KEY: 'test-key',
    VITE_PUBLIC_POSTHOG_HOST: 'test-host',
  },
}))

mock.module('posthog-js', () => {
  return {
    default: {
      init: mock(),
      register: mock(),
    },
  }
})

mock.module('./telemetryStorage', () => ({
  telemetryStorage: {
    getValue: mock(),
  },
}))

describe('initPostHog', () => {
  it('does not init posthog when telemetry is not opted in and in pane build', async () => {
    ;(
      telemetryStorage.getValue as import('bun:test').Mock<any>
    ).mockResolvedValue(false)
    await initPostHog()
    expect(posthog.init).not.toHaveBeenCalled()
  })

  it('inits posthog when telemetry is opted in', async () => {
    ;(
      telemetryStorage.getValue as import('bun:test').Mock<any>
    ).mockResolvedValue(true)
    await initPostHog()
    expect(posthog.init).toHaveBeenCalled()
  })
})
