import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import * as realApprovals from '../../../../src/scheduler/approvals'

// The dry-run-to-approval fix routes through requestChannelApproval (DB +
// push notification). Spy on it so tests control the resolution instantly
// instead of waiting on MCP_APPROVAL_TIMEOUT_MS or touching a real DB.
const requestChannelApprovalSpy = mock(realApprovals.requestChannelApproval)

mock.module('../../../../src/scheduler/approvals', () => ({
  ...realApprovals,
  requestChannelApproval: requestChannelApprovalSpy,
}))

afterAll(() => {
  mock.restore()
  // mock.restore() does not always clear mock.module; re-bind the real
  // module so later test files in the same process aren't poisoned.
  mock.module('../../../../src/scheduler/approvals', () => realApprovals)
})

const { createMcpServer } = await import(
  '../../../../src/api/services/mcp/mcp-server'
)

type InspectableServer = {
  _registeredTools: Record<
    string,
    {
      handler: (args: Record<string, unknown>) => Promise<{
        content: unknown
        isError?: boolean
        structuredContent?: unknown
      }>
    }
  >
}

function inspect(server: unknown) {
  return server as InspectableServer
}

function textOf(result: { content: unknown } | undefined) {
  if (!Array.isArray(result?.content)) return ''
  return result.content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        typeof item === 'object' &&
        item !== null &&
        (item as { type?: string }).type === 'text',
    )
    .map((item) => item.text)
    .join('\n')
}

describe('createMcpServer requestApproval wiring', () => {
  beforeEach(() => {
    requestChannelApprovalSpy.mockClear()
  })

  it('blocks a consequential browser tool on human approval, then executes for real', async () => {
    requestChannelApprovalSpy.mockImplementationOnce(async () => ({
      approval: {} as never,
      resolution: 'approved',
    }))

    const closed: number[] = []
    const server = inspect(
      createMcpServer({
        version: '0.0.0-test',
        browserSession: {
          pages: {
            close: async (page: number) => {
              closed.push(page)
            },
          },
        } as unknown as BrowserSession,
        executionDir: '/tmp/browseros-execution',
        scopeId: 'scope-abc',
      }),
    )

    // 'close' (unlike 'new', which just loads a URL like `navigate`) can drop
    // the user's work and stays gated — a stable example of a consequential
    // browser action for this test.
    const result = await server._registeredTools.tabs.handler({
      action: 'close',
      page: 1,
    })

    expect(result.isError).toBeFalsy()
    // The real tool ran — not a "would close" preview.
    expect(closed).toEqual([1])
    expect(requestChannelApprovalSpy).toHaveBeenCalledTimes(1)
    const call = requestChannelApprovalSpy.mock.calls[0]?.[0]
    expect(call?.runId).toBe('scope-abc')
    expect(call?.toolName).toBe('tabs')
    expect(call?.consequenceClass).toBe('write-external')
    expect(call?.timeoutMs).toBe(realApprovals.MCP_APPROVAL_TIMEOUT_MS)
    // A fresh id per call — no dedupe/reuse across unrelated calls.
    expect(typeof call?.toolCallId).toBe('string')
    expect(call?.toolCallId.length).toBeGreaterThan(0)
    // buildBrowserOsSelfMcpEntry forwards the real chat conversationId as
    // X-BrowserOS-Scope-Id when an ACP provider (e.g. Claude Code) is
    // pointed at our own /mcp — passing it through as conversationId here
    // is what makes the pending approval show up as a normal in-chat
    // Approve/Deny card (useConversationPendingApprovals polls by exact
    // conversationId match) instead of only reaching the user through the
    // much slower, opt-in reach/notification channel.
    expect(call?.conversationId).toBe('scope-abc')
  })

  it('returns a clear denial (not a dry-run preview) and never closes the tab', async () => {
    requestChannelApprovalSpy.mockImplementationOnce(async () => ({
      approval: {} as never,
      resolution: 'denied',
    }))

    const closed: number[] = []
    const server = inspect(
      createMcpServer({
        version: '0.0.0-test',
        browserSession: {
          pages: {
            close: async (page: number) => {
              closed.push(page)
            },
          },
        } as unknown as BrowserSession,
        executionDir: '/tmp/browseros-execution',
        scopeId: 'scope-abc',
      }),
    )

    const result = await server._registeredTools.tabs.handler({
      action: 'close',
      page: 1,
    })

    expect(closed).toEqual([])
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Denied')
    expect(textOf(result)).not.toContain('__promoted')
  })

  it('defaults the approval runId to "ephemeral" when no scope header was sent', async () => {
    requestChannelApprovalSpy.mockImplementationOnce(async () => ({
      approval: {} as never,
      resolution: 'denied',
    }))

    const server = inspect(
      createMcpServer({
        version: '0.0.0-test',
        browserSession: {
          pages: { close: async () => {} },
        } as unknown as BrowserSession,
        executionDir: '/tmp/browseros-execution',
      }),
    )

    await server._registeredTools.tabs.handler({ action: 'close', page: 1 })

    expect(requestChannelApprovalSpy.mock.calls[0]?.[0]?.runId).toBe(
      'ephemeral',
    )
    // No scope header → no conversation to match in the chat UI either.
    expect(
      requestChannelApprovalSpy.mock.calls[0]?.[0]?.conversationId,
    ).toBeUndefined()
  })

  it('never blocks read-only tool calls on approval', async () => {
    const server = inspect(
      createMcpServer({
        version: '0.0.0-test',
        browserSession: {
          pages: {
            getActive: async () => ({
              pageId: 1,
              targetId: 't1',
              tabId: 1,
              url: 'https://example.com',
              title: 'Example',
              isActive: true,
              isLoading: false,
              loadProgress: 1,
              isPinned: false,
              isHidden: false,
            }),
          },
        } as unknown as BrowserSession,
        executionDir: '/tmp/browseros-execution',
      }),
    )

    const result = await server._registeredTools.tabs.handler({
      action: 'active',
    })

    expect(result.isError).toBeFalsy()
    expect(requestChannelApprovalSpy).not.toHaveBeenCalled()
  })

  it('opens a new tab immediately without approval (regression: tabs:new hung waiting on a human, matching navigate)', async () => {
    // tabs:new just loads a URL in a fresh tab, like `navigate` does in the
    // current one — both are 'read'. Before this fix, tabs:new was
    // 'write-external' and blocked on requestChannelApproval; with no reach
    // channel answered in time, external MCP clients (e.g. Claude Code) saw
    // it as a hung call that timed out on their own shorter timeout.
    const opened: string[] = []
    const server = inspect(
      createMcpServer({
        version: '0.0.0-test',
        browserSession: {
          pages: {
            newPage: async (url: string) => {
              opened.push(url)
              return 42
            },
          },
        } as unknown as BrowserSession,
        executionDir: '/tmp/browseros-execution',
      }),
    )

    const result = await server._registeredTools.tabs.handler({
      action: 'new',
      url: 'https://news.ycombinator.com',
    })

    expect(result.isError).toBeFalsy()
    expect(opened).toEqual(['https://news.ycombinator.com'])
    expect(requestChannelApprovalSpy).not.toHaveBeenCalled()
  })
})
