import { expect, mock, test } from 'bun:test'

const agentFetch = mock(async (): Promise<Response> => new Response())
mock.module('@/lib/browseros/agent-fetch', () => ({ agentFetch }))
mock.module('@/lib/browseros/helpers', () => ({
  getAgentServerUrl: async () => 'http://test',
}))
const { attachChatTurnStream } = await import('./chat-turn-api')

test('releases a completion receipt immediately even if the HTTP stream never closes', async () => {
  let cancelled = false
  agentFetch.mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"done","status":"done"}\n\n',
              ),
            )
            // Simulate a proxy/server leaving the connection open after completion.
          },
          cancel() {
            cancelled = true
          },
        }),
      ),
  )
  const events: string[] = []
  await attachChatTurnStream({
    conversationId: 'chat',
    turnId: 'turn',
    onEvent: (event) => {
      events.push(event.type)
    },
  })
  expect(events).toEqual(['done'])
  expect(cancelled).toBe(true)
}, 1000)

test('applies snapshots before terminal and does not consume events after it', async () => {
  agentFetch.mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                [
                  'id: 1\ndata: {"type":"snapshot","messages":[]}\n\n',
                  'id: 2\ndata: {"type":"done","status":"done"}\n\n',
                  'id: 3\ndata: {"type":"snapshot","messages":[]}\n\n',
                ].join(''),
              ),
            )
          },
        }),
      ),
  )
  const events: number[] = []
  await attachChatTurnStream({
    conversationId: 'chat',
    onEvent: (_, seq) => {
      events.push(seq)
    },
  })
  expect(events).toEqual([1, 2])
}, 1000)
