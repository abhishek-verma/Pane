import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { registerBrowserTools } from '@browseros/browser-mcp/tools/register'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildBrowserToolSet } from '../../src/agent/tool-adapter'

describe('Tool Spec Consolidation (M1.6)', () => {
  it('both agent loop and MCP build from the identical tool spec', () => {
    // 1. Build internal tool loop set
    const mockSession = {} as BrowserSession
    const loopTools = buildBrowserToolSet(mockSession)
    const loopToolNames = Object.keys(loopTools).sort()

    // 2. Build MCP server tools
    const mcpServer = new McpServer({ name: 'test', version: '1.0' })
    const registeredToolNames: string[] = []

    // Spy on registerTool
    const originalRegister = mcpServer.registerTool.bind(mcpServer)
    mcpServer.registerTool = ((name: string, ...args: any[]) => {
      registeredToolNames.push(name)
      return originalRegister(name, ...args)
    }) as any

    registerBrowserTools(mcpServer, mockSession)

    const mcpToolNames = registeredToolNames.sort()

    // 3. Assert they are exactly the same
    expect(loopToolNames.length).toBeGreaterThan(0)
    expect(loopToolNames).toEqual(mcpToolNames)
  })
})
