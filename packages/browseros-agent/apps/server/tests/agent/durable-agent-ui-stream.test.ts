import { describe, expect, it } from 'bun:test'
import { MissingToolResultsError } from 'ai'
import { formatAgentStreamError } from '../../src/agent/durable-agent-ui-stream'

describe('formatAgentStreamError', () => {
  it('maps MissingToolResultsError to a friendly approval message', () => {
    const err = new MissingToolResultsError({
      toolCallIds: ['call-1'],
    })
    expect(formatAgentStreamError(err)).toContain('waiting for approval')
  })

  it('maps AI_MissingToolResultsError-shaped objects', () => {
    expect(
      formatAgentStreamError({
        name: 'AI_MissingToolResultsError',
        message: 'Tool result is missing for tool call call-1',
      }),
    ).toContain('waiting for approval')
  })

  it('returns a short first line for other errors', () => {
    expect(formatAgentStreamError(new Error('boom\nstack'))).toBe('boom')
  })

  it('surfaces a structured ACP cause behind an opaque internal error', () => {
    const err = new Error('Internal error')
    ;(err as Error & { cause?: unknown }).cause = {
      data: { message: 'Codex session authentication expired' },
    }
    expect(formatAgentStreamError(err)).toBe(
      'Codex session authentication expired',
    )
  })

  it('maps AI_NoSuchToolError to a short recovery hint', () => {
    expect(
      formatAgentStreamError({
        name: 'AI_NoSuchToolError',
        message:
          "Model tried to call unavailable tool 'Tool: browseros/pi_read'. Available tools: pi_read",
      }),
    ).toContain('did not recognize')
  })

  it('maps opaque AcpxError Internal error to a recovery hint', () => {
    const err = new Error('Internal error')
    err.name = 'AcpxError'
    ;(err as Error & { cause?: unknown }).cause = {
      message: 'Internal error',
      code: 'RUNTIME',
    }
    expect(formatAgentStreamError(err)).toContain('agent runtime')
  })

  it('maps Type validation failures to a short recovery hint', () => {
    expect(
      formatAgentStreamError({
        name: 'AI_TypeValidationError',
        message:
          'Type validation failed: Value: [{"id":"u1","role":"user"}].\nError message: [...]',
      }),
    ).toContain('invalid tool approval state')
  })
})
