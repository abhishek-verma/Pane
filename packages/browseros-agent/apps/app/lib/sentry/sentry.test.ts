import { describe, expect, it, mock } from 'bun:test'
import * as Sentry from '@sentry/react'
import { telemetryStorage } from '../analytics/telemetryStorage'
import { initSentry } from './sentry'

mock.module('../env', () => ({
  env: {
    PANE_BUILD: 'true',
    VITE_PUBLIC_SENTRY_DSN: 'test-dsn',
  },
}))

mock.module('@sentry/react', () => {
  return {
    init: mock(),
    breadcrumbsIntegration: mock(),
    setTag: mock(),
  }
})

mock.module('../analytics/telemetryStorage', () => ({
  telemetryStorage: {
    getValue: mock(),
  },
}))

mock.module('../browseros/adapter', () => ({
  getBrowserOSAdapter: () => ({
    getVersion: mock().mockResolvedValue('1.0'),
    getBrowserosVersion: mock().mockResolvedValue('1.0'),
  }),
}))

describe('initSentry', () => {
  it('does not init sentry when telemetry is not opted in and in pane build', async () => {
    ;(
      telemetryStorage.getValue as import('bun:test').Mock<any>
    ).mockResolvedValue(false)
    await initSentry()
    expect(Sentry.init).not.toHaveBeenCalled()
  })

  it('inits sentry when telemetry is opted in', async () => {
    ;(
      telemetryStorage.getValue as import('bun:test').Mock<any>
    ).mockResolvedValue(true)
    await initSentry()
    expect(Sentry.init).toHaveBeenCalled()
  })
})
