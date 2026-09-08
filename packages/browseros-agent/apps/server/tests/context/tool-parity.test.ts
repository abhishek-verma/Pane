import { describe, expect, it } from 'bun:test'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildPaneToolSet } from '../../src/agent/pane-toolset'
import { registerContextMcpTools } from '../../src/context/register-mcp'

describe('provider-independent Pane capabilities', () => {
  for (const context of [{}, { chatMode: true }, { isScheduledTask: true }]) {
    it(`registers the complete shared inventory on MCP: ${JSON.stringify(context)}`, () => {
      const names: string[] = []
      registerContextMcpTools(
        {
          registerTool: (name: string) => names.push(name),
        } as unknown as McpServer,
        context,
      )
      expect(names.sort()).toEqual(
        Object.keys(buildPaneToolSet(context)).sort(),
      )
      expect(names).toContain('skills_list')
      expect(names).toContain('skills_load')
      expect(names.includes('suggest_schedule')).toBe(
        !context.chatMode && !context.isScheduledTask,
      )
    })
  }
})
