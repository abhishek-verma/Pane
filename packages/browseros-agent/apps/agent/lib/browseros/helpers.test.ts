import { describe, expect, it } from 'bun:test'
import { BROWSEROS_PREFS } from './prefs'

describe('getAgentServerUrl', () => {
  it('uses the BrowserOS MCP port as the server URL', async () => {
    const previousChrome = globalThis.chrome
    const prefRequests: string[] = []
    try {
      globalThis.chrome = {
        runtime: {},
        browserOS: {
          getBrowserosVersionNumber(
            callback: (version: string | null) => void,
          ) {
            callback(null)
          },
          getPref(name: string, callback: (pref: { value?: unknown }) => void) {
            prefRequests.push(name)
            callback(
              name === BROWSEROS_PREFS.MCP_PORT
                ? { value: 9105 }
                : { value: null },
            )
          },
        },
      } as typeof chrome

      const { getAgentServerUrl } = await import('./helpers')

      await expect(getAgentServerUrl()).resolves.toBe('http://127.0.0.1:9105')
      expect(prefRequests).toContain(BROWSEROS_PREFS.MCP_PORT)
      expect(prefRequests).not.toContain('browseros.server.agent_port')
    } finally {
      globalThis.chrome = previousChrome
    }
  })
})
