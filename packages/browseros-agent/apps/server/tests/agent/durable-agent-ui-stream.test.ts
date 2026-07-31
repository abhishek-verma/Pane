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
