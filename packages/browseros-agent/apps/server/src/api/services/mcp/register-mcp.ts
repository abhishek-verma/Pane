import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Browser } from '../../../browser/browser'
import type { BrowserSession } from '../../../browser/core/session'
import {
  type BrowserToolDefaults,
  registerBrowserTools,
} from '../../../tools/browser/register'
import { registerLegacyBrowserTools } from '../../../tools/legacy/register'

export interface RegisterToolsDeps extends BrowserToolDefaults {
  browser: Browser
  browserSession: BrowserSession
  useNewTools?: boolean
}

/** Registers the active BrowserOS browser tools for MCP requests. */
export function registerTools(
  mcpServer: McpServer,
  deps: RegisterToolsDeps,
): void {
  const defaults = {
    defaultWindowId: deps.defaultWindowId,
    defaultTabGroupId: deps.defaultTabGroupId,
  }

  if (deps.useNewTools !== false) {
    registerBrowserTools(mcpServer, deps.browserSession, defaults)
    return
  }

  registerLegacyBrowserTools(mcpServer, deps.browser, defaults)
}
