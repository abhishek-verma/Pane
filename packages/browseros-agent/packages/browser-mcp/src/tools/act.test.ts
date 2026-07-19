import { describe, expect, it } from 'bun:test'
import { act } from './act'

describe('act post-actions', () => {
  it('queues structured diff and screenshot after a successful click', async () => {
    const calls: string[] = []
    const response = {
      data: () => {},
      includeDiff: (page: number, opts?: { includeStructured?: boolean }) => {
        calls.push(`diff:${page}:${Boolean(opts?.includeStructured)}`)
      },
      includeScreenshot: (page: number) => {
        calls.push(`screenshot:${page}`)
      },
    }
    const ctx = {
      session: {
        input: () => ({
          click: async () => {},
        }),
      },
    }

    const result = await act.handler(
      { page: 1, kind: 'click', ref: 'e1' },
      ctx as never,
      response as never,
    )

    expect(result).toEqual({
      content: [{ type: 'text', text: 'ok (click)' }],
    })
    expect(calls).toEqual(['diff:1:true', 'screenshot:1'])
  })

  it('does not queue post-actions when the act fails', async () => {
    const calls: string[] = []
    const response = {
      data: () => {
        calls.push('data')
      },
      includeDiff: () => {
        calls.push('diff')
      },
      includeScreenshot: () => {
        calls.push('screenshot')
      },
    }
    const ctx = {
      session: {
        input: () => ({
          click: async () => {},
        }),
      },
    }

    const result = await act.handler(
      { page: 1, kind: 'click' },
      ctx as never,
      response as never,
    )

    expect(result?.isError).toBe(true)
    expect(calls).toEqual([])
  })
})
