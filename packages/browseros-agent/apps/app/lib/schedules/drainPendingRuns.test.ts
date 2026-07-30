/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it, mock } from 'bun:test'
import { drainPendingRunsOnce } from '@/lib/schedules/drainPendingRuns'

describe('drainPendingRunsOnce', () => {
  it('claims, chats, then completes in order', async () => {
    const calls: string[] = []
    const fetchFn = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/scheduler/runs?status=pending')) {
          calls.push('list')
          return new Response(
            JSON.stringify({
              runs: [
                {
                  id: 'run_1',
                  prompt: 'do the thing',
                  idempotencyKey: 'trigger:r1:e1',
                  status: 'pending',
                  source: 'trigger',
                },
              ],
            }),
            { status: 200 },
          )
        }
        if (
          url.endsWith('/scheduler/runs/run_1/claim') &&
          init?.method === 'POST'
        ) {
          calls.push('claim')
          return new Response(
            JSON.stringify({
              run: { id: 'run_1', status: 'running' },
            }),
            { status: 200 },
          )
        }
        if (url.endsWith('/scheduler/runs/run_1') && init?.method === 'PATCH') {
          calls.push('patch')
          return new Response(JSON.stringify({ run: { id: 'run_1' } }), {
            status: 200,
          })
        }
        if (
          url.endsWith('/scheduler/runs/run_1/complete') &&
          init?.method === 'POST'
        ) {
          calls.push('complete')
          const body = JSON.parse(String(init.body)) as {
            status: string
            result?: string
          }
          expect(body.status).toBe('completed')
          expect(body.result).toBe('done')
          return new Response(
            JSON.stringify({ run: { id: 'run_1', status: 'completed' } }),
            { status: 200 },
          )
        }
        throw new Error(`unexpected fetch ${url}`)
      },
    ) as unknown as typeof fetch

    const runChat = mock(
      async (input: {
        message: string
        scheduledRunId: string
        idempotencyKey: string
      }) => {
        calls.push('chat')
        expect(input.message).toBe('do the thing')
        expect(input.scheduledRunId).toBe('run_1')
        expect(input.idempotencyKey).toBe('trigger:r1:e1')
        return { text: 'done', conversationId: 'conv_1' }
      },
    )

    const result = await drainPendingRunsOnce({
      getBaseUrl: async () => 'http://127.0.0.1:9100',
      fetchFn,
      runChat,
    })

    expect(calls).toEqual(['list', 'claim', 'patch', 'chat', 'complete'])
    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0 })
  })

  it('filters by runIds and skipSources', async () => {
    const claimed: string[] = []
    const fetchFn = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('status=pending')) {
          return new Response(
            JSON.stringify({
              runs: [
                {
                  id: 'mat_1',
                  prompt: 'a',
                  idempotencyKey: 'k1',
                  status: 'pending',
                  source: 'pi-materialize',
                },
                {
                  id: 'har_1',
                  prompt: 'b',
                  idempotencyKey: 'k2',
                  status: 'pending',
                  source: 'pi-harvest',
                },
              ],
            }),
            { status: 200 },
          )
        }
        if (url.includes('/claim') && init?.method === 'POST') {
          const id = url.split('/runs/')[1]?.split('/')[0] ?? ''
          claimed.push(id)
          return new Response(JSON.stringify({ run: { id } }), { status: 200 })
        }
        if (init?.method === 'PATCH') {
          return new Response('{}', { status: 200 })
        }
        if (url.includes('/complete')) {
          return new Response('{}', { status: 200 })
        }
        throw new Error(`unexpected ${url}`)
      },
    ) as unknown as typeof fetch

    await drainPendingRunsOnce({
      getBaseUrl: async () => 'http://127.0.0.1:9100',
      fetchFn,
      skipSources: ['pi-materialize'],
      runChat: async () => ({ text: 'ok', conversationId: 'c' }),
    })
    expect(claimed).toEqual(['har_1'])

    claimed.length = 0
    await drainPendingRunsOnce({
      getBaseUrl: async () => 'http://127.0.0.1:9100',
      fetchFn,
      runIds: ['mat_1'],
      runChat: async () => ({ text: 'ok', conversationId: 'c' }),
    })
    expect(claimed).toEqual(['mat_1'])
  })

  it('marks failed when chat throws', async () => {
    const fetchFn = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('status=pending')) {
          return new Response(
            JSON.stringify({
              runs: [
                {
                  id: 'run_2',
                  prompt: 'fail',
                  idempotencyKey: 'k2',
                  status: 'pending',
                },
              ],
            }),
            { status: 200 },
          )
        }
        if (url.endsWith('/claim')) {
          return new Response(JSON.stringify({ run: { id: 'run_2' } }), {
            status: 200,
          })
        }
        if (init?.method === 'PATCH') {
          return new Response('{}', { status: 200 })
        }
        if (url.endsWith('/complete')) {
          const body = JSON.parse(String(init?.body)) as {
            status: string
            error?: string
          }
          expect(body.status).toBe('failed')
          expect(body.error).toContain('boom')
          return new Response(JSON.stringify({ run: { id: 'run_2' } }), {
            status: 200,
          })
        }
        throw new Error(`unexpected ${url}`)
      },
    ) as unknown as typeof fetch

    const result = await drainPendingRunsOnce({
      getBaseUrl: async () => 'http://127.0.0.1:9100',
      fetchFn,
      runChat: async () => {
        throw new Error('boom')
      },
    })

    expect(result.claimed).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.completed).toBe(0)
  })
})
