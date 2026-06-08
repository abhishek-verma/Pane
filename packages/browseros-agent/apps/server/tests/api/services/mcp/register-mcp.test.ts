import { describe, expect, it } from 'bun:test'
import { registerTools } from '../../../../src/api/services/mcp/register-mcp'
import type { BrowserSession } from '../../../../src/browser/core/session'
import { BROWSER_TOOLS } from '../../../../src/tools/browser/registry'

type RegisteredHandler = (
  args: Record<string, unknown>,
  extra?: { signal?: AbortSignal },
) => Promise<{
  content: unknown
  isError?: boolean
  structuredContent?: unknown
}>

function createFakeServer() {
  const handlers = new Map<string, RegisteredHandler>()
  const configs = new Map<
    string,
    { description: string; inputSchema?: unknown }
  >()

  return {
    handlers,
    configs,
    server: {
      registerTool(
        name: string,
        config: { description: string; inputSchema?: unknown },
        handler: RegisteredHandler,
      ) {
        configs.set(name, config)
        handlers.set(name, handler)
      },
    },
  }
}

describe('registerTools', () => {
  it('registers the new compact browser tools by default', () => {
    const fake = createFakeServer()

    registerTools(fake.server as never, {
      browser: {} as never,
      browserSession: { pages: {} } as unknown as BrowserSession,
    })

    expect([...fake.handlers.keys()]).toEqual(BROWSER_TOOLS.map((t) => t.name))
    expect(fake.handlers.size).toBe(10)
  })

  it('registers the legacy browser tools when the switch is disabled', () => {
    const fake = createFakeServer()

    registerTools(fake.server as never, {
      browser: {} as never,
      browserSession: { pages: {} } as unknown as BrowserSession,
      useNewTools: false,
    })

    expect(fake.handlers.has('tabs')).toBe(false)
    expect(fake.handlers.has('new_page')).toBe(true)
    expect(fake.handlers.has('get_bookmarks')).toBe(true)
    expect(fake.handlers.has('browseros_info')).toBe(true)
  })

  it('applies scoped defaults to legacy page creation tools', async () => {
    const fake = createFakeServer()
    const newPageCalls: Array<{
      url: string
      opts?: { windowId?: number; background?: boolean; hidden?: boolean }
    }> = []
    const groupCalls: Array<{
      pageIds: number[]
      opts: { groupId?: string }
    }> = []

    registerTools(fake.server as never, {
      browser: {
        newPage: async (
          url: string,
          opts?: { windowId?: number; background?: boolean; hidden?: boolean },
        ) => {
          newPageCalls.push({ url, opts })
          return 42
        },
        groupTabs: async (pageIds: number[], opts: { groupId?: string }) => {
          groupCalls.push({ pageIds, opts })
        },
        listPages: async () => [],
      } as never,
      browserSession: { pages: {} } as unknown as BrowserSession,
      useNewTools: false,
      defaultWindowId: 7,
      defaultTabGroupId: 'group-a',
    })

    const result = await fake.handlers.get('new_page')?.({
      url: 'https://example.com',
    })

    expect(result?.isError).toBeFalsy()
    expect(newPageCalls).toEqual([
      {
        url: 'https://example.com',
        opts: { hidden: undefined, background: true, windowId: 7 },
      },
    ])
    expect(groupCalls).toEqual([
      { pageIds: [42], opts: { groupId: 'group-a' } },
    ])
  })
})
