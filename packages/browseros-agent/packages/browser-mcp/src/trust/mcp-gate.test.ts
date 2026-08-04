import { describe, expect, it } from 'bun:test'
import type {
  GateApprovalRequest,
  GateContext,
} from '@browseros/shared/trust/consequence-class'
import { createDefaultMcpGateContext, gateMcpHandler } from './mcp-gate'

function makeCtx(overrides: Partial<GateContext> = {}): GateContext {
  return createDefaultMcpGateContext(overrides)
}

describe('gateMcpHandler without requestApproval (back-compat)', () => {
  it('returns the static dry-run preview and never calls underlying', async () => {
    let called = false
    const result = await gateMcpHandler(
      'evaluate',
      { code: 'document.title' },
      makeCtx(),
      async () => {
        called = true
        return { content: [{ type: 'text', text: 'ran' }] }
      },
    )
    expect(called).toBe(false)
    expect(result.isError).toBeFalsy()
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? ''
    expect(text).toContain('Dry-run.')
    expect(text).toContain('__promoted:true')
  })
})

describe('gateMcpHandler with requestApproval', () => {
  it('executes the underlying tool once a human approves', async () => {
    const requests: GateApprovalRequest[] = []
    let executedArgs: Record<string, unknown> | undefined
    const ctx = makeCtx({
      requestApproval: async (request) => {
        requests.push(request)
        return 'approved'
      },
    })

    // 'close' (unlike 'new', which just loads a URL like `navigate`) can drop
    // the user's work and stays gated — a stable example of a consequential
    // browser action for this test.
    const result = await gateMcpHandler(
      'tabs',
      { action: 'close', page: 1 },
      ctx,
      async (args) => {
        executedArgs = args
        return { content: [{ type: 'text', text: 'closed' }] }
      },
    )

    expect(requests).toHaveLength(1)
    expect(requests[0].toolName).toBe('tabs')
    expect(requests[0].consequenceClass).toBe('write-external')
    // The approval prompt is a clean human-readable description, not the
    // "re-call with __promoted:true" instruction meant for a self-promoting model.
    expect(requests[0].preview).not.toContain('__promoted')

    // __promoted must never reach the underlying tool implementation.
    expect(executedArgs).toEqual({ action: 'close', page: 1 })
    expect(result.isError).toBeFalsy()
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? ''
    expect(text).toBe('closed')
  })

  it('returns a clear denial and never calls underlying when denied', async () => {
    let called = false
    const ctx = makeCtx({
      requestApproval: async () => 'denied',
    })

    const result = await gateMcpHandler(
      'evaluate',
      { code: 'alert(1)' },
      ctx,
      async () => {
        called = true
        return { content: [{ type: 'text', text: 'ran' }] }
      },
    )

    expect(called).toBe(false)
    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? ''
    expect(text).toContain('Denied')
    // No dead-end "re-call" instruction — the client got a final answer.
    expect(text).not.toContain('__promoted')
  })

  it('returns a clear timeout message and never calls underlying on timeout', async () => {
    let called = false
    const ctx = makeCtx({
      requestApproval: async () => 'timeout',
    })

    const result = await gateMcpHandler(
      'run',
      { code: 'await fetch(1)' },
      ctx,
      async () => {
        called = true
        return { content: [{ type: 'text', text: 'ran' }] }
      },
    )

    expect(called).toBe(false)
    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? ''
    expect(text).toContain('timed out')
  })

  it('never invokes requestApproval for read tools', async () => {
    let called = false
    const ctx = makeCtx({
      requestApproval: async () => {
        called = true
        return 'approved'
      },
    })

    const result = await gateMcpHandler('snapshot', {}, ctx, async () => ({
      content: [{ type: 'text', text: 'snap' }],
    }))

    expect(called).toBe(false)
    expect(result.isError).toBeFalsy()
  })

  it('never invokes requestApproval when the call is already promoted', async () => {
    // A real MCP tool schema never exposes __promoted (stripped/rejected
    // before reaching the handler), but the gate itself must not re-prompt
    // if it somehow receives it — no double-approval, no bypass either way.
    let called = false
    const ctx = makeCtx({
      requestApproval: async () => {
        called = true
        return 'approved'
      },
    })

    const result = await gateMcpHandler(
      'evaluate',
      { code: '1', __promoted: true },
      ctx,
      async () => ({ content: [{ type: 'text', text: 'ran' }] }),
    )

    expect(called).toBe(false)
    expect(result.isError).toBeFalsy()
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? ''
    expect(text).toBe('ran')
  })
})
