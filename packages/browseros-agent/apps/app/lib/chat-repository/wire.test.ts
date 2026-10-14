import { expect, test } from 'bun:test'
import { RepositoryRequestChunks, sendRepositoryRequest } from './wire'

test('large attachment requests round-trip over bounded port messages', () => {
  const message = {
    type: 'request',
    requestId: 'request',
    payload: { body: '🙂'.repeat(600_000) },
  }
  const packets: any[] = []
  sendRepositoryRequest((value) => packets.push(value), message)
  expect(packets.length).toBeGreaterThan(2)
  const receiver = new RepositoryRequestChunks()
  let assembled: unknown
  for (const packet of packets) {
    expect(JSON.stringify(packet).length).toBeLessThan(600_000)
    assembled = receiver.accept(packet) ?? assembled
  }
  expect(assembled).toEqual(message)
  receiver.dispose()
})
test('incomplete/disconnected uploads cannot be reused as commands', () => {
  const receiver = new RepositoryRequestChunks()
  receiver.accept({
    type: 'request-chunk',
    requestId: 'request',
    data: '{"type":"request"',
  })
  receiver.dispose()
  expect(() =>
    receiver.accept({ type: 'request-complete', requestId: 'request' }),
  ).toThrow('expired')
})
