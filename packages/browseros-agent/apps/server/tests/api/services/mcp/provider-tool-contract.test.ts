import { expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildPaneToolSet } from '../../../../src/agent/pane-toolset'
import { buildBrowserToolSet } from '../../../../src/agent/tool-adapter'
import { createMcpServer } from '../../../../src/api/services/mcp/mcp-server'
import { buildFilesystemToolSet } from '../../../../src/tools/filesystem/build-toolset'
import { defaultWorkspace } from '../../../../src/tools/filesystem/workspace'

// Exercise the public protocol, not a mock of registerTool. Every new tool in
// any shared registry must survive serialization and MCP discovery.
it('exposes the entire API workspace inventory through the ACP MCP protocol', async () => {
  const session = { pages: {} } as unknown as BrowserSession
  const workspace = defaultWorkspace('/tmp/pane-contract-workspace')
  const expected = {
    ...buildBrowserToolSet(session),
    ...buildFilesystemToolSet(workspace),
    ...buildPaneToolSet({ workingDir: workspace.root }),
  }
  const server = createMcpServer({
    version: 'test',
    browserSession: session,
    workspace,
    executionDir: workspace.root,
  })
  const client = new Client({ name: 'provider-contract', version: 'test' })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const listed = await client.listTools()
    expect(listed.nextCursor).toBeUndefined()
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
      Object.keys(expected).sort(),
    )
    for (const entry of listed.tools) {
      expect(entry.description).toBe(expected[entry.name].description)
      expect(entry.inputSchema.type).toBe('object')
    }
    // Actual execution confirms a listed tool is callable and its return value
    // survives the adapter. This sentinel does not create a scheduled task.
    const suggestion = await client.callTool({
      name: 'suggest_schedule',
      arguments: {
        query: 'test',
        suggestedName: 'Contract',
        scheduleType: 'daily',
      },
    })
    expect(suggestion.isError).not.toBe(true)
    expect(JSON.stringify(suggestion.content)).toContain('schedule_suggestion')
  } finally {
    await client.close()
    await server.close()
  }
})
