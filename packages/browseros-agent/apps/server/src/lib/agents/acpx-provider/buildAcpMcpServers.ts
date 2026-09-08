/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { CustomMcpServer } from '@browseros/shared/schemas/browser-context'
import type { McpServerSpec } from './buildAcpxProvider'
import {
  type BuildBrowserOsSelfMcpOptions,
  buildBrowserOsSelfMcpEntry,
} from './buildBrowserOsSelfMcp'

export interface BuildAcpMcpServersOptions
  extends BuildBrowserOsSelfMcpOptions {
  /**
   * User-configured external MCP servers from `browserContext.customMcpServers`.
   * Each entry becomes its own `http` entry in the returned array. Names are
   * preserved as the user typed them; BrowserOS's own entry is prepended so
   * it wins on duplicate names (matches agent-company's precedence rule).
   */
  customMcpServers?: ReadonlyArray<CustomMcpServer>
}

/**
 * Assemble the full `mcpServers` array passed to `buildAcpxProvider` for
 * ACP-backed providers. BrowserOS's own MCP route is always first; user-
 * configured entries follow.
 */
export function buildAcpMcpServers(
  opts: BuildAcpMcpServersOptions,
): McpServerSpec[] {
  const out: McpServerSpec[] = [buildBrowserOsSelfMcpEntry(opts)]
  const names = new Set(out.map((server) => server.name))
  for (const server of opts.customMcpServers ?? []) {
    // ACP clients commonly index servers by name (last entry wins). Never
    // allow a custom connector to shadow Pane's entire tool surface.
    let name = server.name
    for (let suffix = 1; names.has(name); suffix++) {
      name = `${server.name}_custom_${suffix}`
    }
    names.add(name)
    out.push({
      type: 'http',
      name,
      url: server.url,
      headers: [],
    })
  }
  return out
}
