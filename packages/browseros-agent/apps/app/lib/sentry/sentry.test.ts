import { beforeAll, describe, expect, it, mock } from 'bun:test'
import * as Sentry from '@sentry/react'

mock.module('@wxt-dev/storage', () => ({
  storage: {
    defineItem: mock().mockReturnValue({
      getValue: mock(),
    }),
  },
}))

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

let telemetryStorage: any
let initSentry: any

beforeAll(async () => {
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '1.0' }),
    },
  } as any

  ;({ telemetryStorage } = await import('../analytics/telemetryStorage'))
  ;({ initSentry } = await import('./sentry'))
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
  // bun's mock.module has no per-file scope — this mock can win the
  // registration race for the whole process, so it must export everything
  // ./adapter's real module does (profile-key.ts imports this too).
  PrefApiUnavailableError: class extends Error {},
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
