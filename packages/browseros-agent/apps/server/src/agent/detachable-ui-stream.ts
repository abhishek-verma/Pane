/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Tee an AI SDK UI message Response so the agent stream keeps running when
 * the HTTP client disconnects. One branch is always fully consumed in the
 * background (drives onStepFinish/onFinish); the other is returned to the
 * caller and cancelled on httpSignal abort.
 */

/**
 * Returns a Response whose body is cancelled when `httpSignal` aborts, while
 * the original agent body continues to be drained in the background.
 */
export function detachableUiStreamResponse(
  agentResponse: Response,
  options: {
    httpSignal: AbortSignal
    turnId: string
  },
): Response {
  const body = agentResponse.body
  if (!body) {
    return withTurnHeader(agentResponse, options.turnId)
  }

  const [forClient, forBackground] = body.tee()

  void drainStream(forBackground).catch(() => {
    // Background drain errors are non-fatal; onFinish may still have run.
  })

  const headers = new Headers(agentResponse.headers)
  headers.set('X-Turn-Id', options.turnId)
  // Expose for browser extension fetch
  const exposed = headers.get('Access-Control-Expose-Headers')
  headers.set(
    'Access-Control-Expose-Headers',
    exposed ? `${exposed}, X-Turn-Id` : 'X-Turn-Id',
  )

  // Already detached: do not wrap a cancelled branch (Bun rejects "already used").
  if (options.httpSignal.aborted) {
    void forClient.cancel('client-detach').catch(() => {})
    return new Response(null, {
      status: agentResponse.status,
      statusText: agentResponse.statusText,
      headers,
    })
  }

  const onAbort = () => {
    void forClient.cancel('client-detach').catch(() => {})
  }
  options.httpSignal.addEventListener('abort', onAbort, { once: true })

  return new Response(forClient, {
    status: agentResponse.status,
    statusText: agentResponse.statusText,
    headers,
  })
}

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  try {
    while (true) {
      const { done } = await reader.read()
      if (done) return
    }
  } finally {
    reader.releaseLock()
  }
}

function withTurnHeader(response: Response, turnId: string): Response {
  const headers = new Headers(response.headers)
  headers.set('X-Turn-Id', turnId)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** SSE response for late joiners (snapshot + done frames). */
export function chatTurnAttachSseResponse(
  frames: ReadableStream<{
    seq: number
    event: unknown
    createdAt: number
  }>,
  options: { turnId: string; signal?: AbortSignal },
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const reader = frames.getReader()
      const onAbort = () => {
        void reader.cancel('client-detach').catch(() => {})
      }
      if (options.signal?.aborted) {
        onAbort()
      } else {
        options.signal?.addEventListener('abort', onAbort, { once: true })
      }
      try {
        controller.enqueue(
          encoder.encode(
            `event: turn\ndata: ${JSON.stringify({ turnId: options.turnId })}\n\n`,
          ),
        )
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value) continue
          controller.enqueue(
            encoder.encode(
              `id: ${value.seq}\ndata: ${JSON.stringify(value.event)}\n\n`,
            ),
          )
          const event = value.event as { type?: string }
          if (event.type === 'done') break
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch {
        try {
          controller.close()
        } catch {
          // ignore
        }
      } finally {
        options.signal?.removeEventListener('abort', onAbort)
        reader.releaseLock()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Turn-Id': options.turnId,
      'Access-Control-Expose-Headers': 'X-Turn-Id',
    },
  })
}
