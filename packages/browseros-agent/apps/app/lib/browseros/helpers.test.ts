import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { BROWSEROS_PROFILE_ID_QUERY_PARAM } from '@browseros/shared/constants/headers'

const MCP_PORT_PREF = 'browseros.server.mcp_port'
const PROXY_PORT_PREF = 'browseros.server.proxy_port'
const METRICS_CLIENT_ID_PREF = 'browseros.metrics_client_id'
const PROFILE_KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
let originalChrome: typeof globalThis.chrome | undefined

// Resolve getBrowserProfileKey() through the real './adapter' pref path
// (mocked below) rather than mock.module('./profile-key', ...) — bun's
// mock.module registrations leak across test files run in the same
// process, and this file already owns the './adapter' mock, so there is
// nothing else to race with.
function readPref(name: string): { value: unknown } {
  if (name === MCP_PORT_PREF) return { value: 9105 }
  if (name === PROXY_PORT_PREF) return { value: 9106 }
  if (name === METRICS_CLIENT_ID_PREF) return { value: PROFILE_KEY }
  return { value: null }
}

mock.module('./prefs', () => ({
  BROWSEROS_PREFS: {
    MCP_PORT: MCP_PORT_PREF,
    PROVIDERS: 'browseros.providers',
    PROXY_PORT: PROXY_PORT_PREF,
    SERVER_PORT: 'browseros.server.server_port',
    ALLOW_REMOTE_MCP: 'browseros.server.allow_remote_in_mcp',
    RESTART_SERVER: 'browseros.server.restart_requested',
    SHOW_TOOLBAR_LABELS: 'browseros.show_toolbar_labels',
    VERTICAL_TABS_ENABLED: 'browseros.vertical_tabs_enabled',
    INSTALL_ID: 'browseros.metrics_install_id',
    METRICS_CLIENT_ID: 'browseros.metrics_client_id',
  },
}))

mock.module('./adapter', () => ({
  BrowserOSAdapter: {
    getInstance: () => ({
      getPref: async (name: string) => readPref(name),
      getBrowserosVersion: async () => null,
    }),
  },
  getBrowserOSAdapter: () => ({
    getPref: async (name: string) => readPref(name),
  }),
}))

describe('BrowserOS helper URLs', () => {
  beforeEach(() => {
    originalChrome = globalThis.chrome
    Object.assign(globalThis, {
      chrome: {
        ...originalChrome,
        browserOS: {
          ...originalChrome?.browserOS,
          getPref: (
            name: string,
            resolve: (result: { value: unknown }) => void,
          ) => {
            resolve(readPref(name))
          },
        },
      },
    })
  })

  afterEach(() => {
    if (originalChrome) {
      Object.assign(globalThis, { chrome: originalChrome })
      return
    }
    Reflect.deleteProperty(globalThis, 'chrome')
  })

  it('uses the BrowserOS MCP port as the server URL', async () => {
    const { getAgentServerUrl } = await import('./helpers')

    await expect(getAgentServerUrl()).resolves.toBe('http://127.0.0.1:9105')
  })

  it('uses the BrowserOS proxy port for MCP requests, with the profile id embedded', async () => {
    const { getMcpServerUrl } = await import('./helpers')

    // Structural assertion, not exact-string: bun's mock.module has no
    // per-file scope, so another test file that mocks this same module
    // process-wide (see lib/schedules/provider-resolution.test.ts) can win
    // the race depending on run order. Both the real implementation and
    // that file's stub produce this same shape, so the contract holds
    // either way — only the exact profile value can legitimately differ.
    const url = new URL(await getMcpServerUrl())
    expect(url.origin).toBe('http://127.0.0.1:9106')
    expect(url.pathname).toBe('/mcp')
    expect(url.searchParams.get(BROWSEROS_PROFILE_ID_QUERY_PARAM)).toBeTruthy()
  })

  it('uses the BrowserOS proxy port for health checks', async () => {
    const { getHealthCheckUrl } = await import('./helpers')

    await expect(getHealthCheckUrl()).resolves.toBe(
      'http://127.0.0.1:9106/health',
    )
  })
})
