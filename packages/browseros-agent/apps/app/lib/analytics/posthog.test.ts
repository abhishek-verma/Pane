import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

mock.module('../env', () => ({
  env: {
    PANE_BUILD: 'true',
    VITE_PUBLIC_POSTHOG_KEY: 'test-key',
    VITE_PUBLIC_POSTHOG_HOST: 'test-host',
  },
}))

const initMock = mock()
const registerMock = mock()

mock.module('posthog-js', () => {
  return {
    default: {
      init: initMock,
      register: registerMock,
    },
  }
})

const getValueMock = mock()
mock.module('./telemetryStorage', () => ({
  telemetryStorage: {
    getValue: getValueMock,
  },
}))

mock.module('@wxt-dev/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: getValueMock,
      setValue: mock(),
    }),
  },
}))

const { initPostHog } = await import('./posthog')
const posthog = (await import('posthog-js')).default

describe('initPostHog', () => {
  beforeEach(() => {
    initMock.mockClear()
    getValueMock.mockReset()
  })

  it('does not init posthog when telemetry is not opted in and in pane build', async () => {
    getValueMock.mockResolvedValue(false)
    await initPostHog()
    expect(initMock).not.toHaveBeenCalled()
  })

  it('inits posthog when telemetry is opted in', async () => {
    getValueMock.mockResolvedValue(true)
    await initPostHog()
    expect(initMock).toHaveBeenCalled()
  })

  it('never enables session recording', async () => {
    getValueMock.mockResolvedValue(true)
    await initPostHog()
    expect(initMock).toHaveBeenCalled()
    const opts = initMock.mock.calls[0]?.[1] as
      | {
          disable_session_recording?: boolean
          session_recording?: unknown
        }
      | undefined
    expect(opts?.disable_session_recording).toBe(true)
    expect(opts?.session_recording).toBeUndefined()
  })

  it('source must not import posthog-recorder', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(dir, 'posthog.ts'), 'utf8')
    expect(source).not.toContain('posthog-recorder')
    expect(source).not.toMatch(/posthog-js\/dist\/posthog-recorder/)
  })
})

// silence unused
void posthog
