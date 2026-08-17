import { BROWSEROS_PROFILE_ID_QUERY_PARAM } from '@browseros/shared/constants/headers'
import { getBrowserOSAdapter } from './adapter'
import { BROWSEROS_PREFS } from './prefs'
import { getBrowserProfileKey } from './profile-key'

class McpPortError extends Error {
  constructor() {
    super('MCP server port not configured.')
    this.name = 'McpPortError'
  }
}

/**
 * Returns the local BrowserOS server base URL for chat and agent APIs.
 * BrowserOS publishes this through the unified MCP/server-port preference.
 */
export async function getAgentServerUrl(): Promise<string> {
  const port = await getMcpPort()
  return `http://127.0.0.1:${port}`
}

async function getMcpPort(): Promise<number> {
  try {
    const adapter = getBrowserOSAdapter()
    const pref = await adapter.getPref(BROWSEROS_PREFS.MCP_PORT)

    if (pref?.value && typeof pref.value === 'number') {
      return pref.value
    }
  } catch {
    // BrowserOS API not available
  }

  throw new McpPortError()
}

/**
 * Returns the MCP proxy endpoint for local server connections, with this
 * Chrome profile's id embedded as a query param. External MCP clients
 * (Claude Code, Claude Desktop, Codex, ...) are configured with this exact
 * URL and cannot set a custom header, so without the embedded id the server
 * has no way to know which profile's data (SOUL.md, USER.md, memory,
 * skills) a call belongs to — it would silently write to the profile-less
 * install root instead of what Settings/chat read. Embedding it here makes
 * every copy-pasted snippet correct by construction, not by chance.
 */
export async function getMcpServerUrl(): Promise<string> {
  const [port, profileKey] = await Promise.all([
    getProxyPort(),
    getBrowserProfileKey(),
  ])
  const url = new URL(`http://127.0.0.1:${port}/mcp`)
  url.searchParams.set(BROWSEROS_PROFILE_ID_QUERY_PARAM, profileKey)
  return url.toString()
}

class ProxyPortError extends Error {
  constructor() {
    super('Proxy server port not configured.')
    this.name = 'ProxyPortError'
  }
}

export async function getProxyPort(): Promise<number> {
  try {
    const adapter = getBrowserOSAdapter()
    const pref = await adapter.getPref(BROWSEROS_PREFS.PROXY_PORT)

    if (pref?.value && typeof pref.value === 'number') {
      return pref.value
    }
  } catch {
    // BrowserOS API not available
  }

  throw new ProxyPortError()
}

/** Returns the MCP proxy health-check endpoint. */
export async function getHealthCheckUrl(): Promise<string> {
  const port = await getProxyPort()
  return `http://127.0.0.1:${port}/health`
}
