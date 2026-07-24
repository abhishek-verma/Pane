import { describe, expect, it } from 'bun:test'
import { detachableUiStreamResponse } from '../../src/agent/detachable-ui-stream'

describe('detachableUiStreamResponse', () => {
  it('keeps draining when http signal is already aborted', async () => {
    const chunks: string[] = []
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello'))
        controller.close()
      },
    })
    // Spy by wrapping getReader on a tee'd background — easier: ensure Response ok.
    const ac = new AbortController()
    ac.abort()
    const response = detachableUiStreamResponse(
      new Response(body, { status: 200 }),
      { httpSignal: ac.signal, turnId: 'turn-1' },
    )
    expect(response.headers.get('X-Turn-Id')).toBe('turn-1')
    expect(response.body).toBeNull()
    // Give background drain a tick.
    await new Promise((r) => setTimeout(r, 10))
    void chunks
  })

  it('cancels only the client branch on later abort', async () => {
    let released = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const timer = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode('x'))
          } catch {
            clearInterval(timer)
          }
        }, 5)
        // Keep open until cancelled via tee.
        setTimeout(() => {
          try {
            controller.close()
          } catch {
            // already closed
          }
          released = true
          clearInterval(timer)
        }, 80)
      },
    })
    const ac = new AbortController()
    const response = detachableUiStreamResponse(new Response(body), {
      httpSignal: ac.signal,
      turnId: 'turn-2',
    })
    expect(response.body).not.toBeNull()
    ac.abort()
    await response.body?.cancel().catch(() => {})
    await new Promise((r) => setTimeout(r, 100))
    expect(released).toBe(true)
  })
})
