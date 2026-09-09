import { describe, expect, it } from 'bun:test'
import { LayerActionEvents } from './action-events'

const binding = {
  profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  invocationId: 'run',
  layerId: 'layer',
  layerVersion: 'a'.repeat(64),
  actionId: 'translate',
  tabId: 1,
  frameId: 0 as const,
  documentId: 'doc',
  instanceId: 'instance',
  routeEpoch: 0,
  snapshotId: 'snapshot',
  revocationGeneration: 0,
}
const data = {
  schema: 'pane.translation.v1' as const,
  targetLanguage: 'en',
  blocks: [{ blockId: 'block', translatedText: 'Hello' }],
}
const event = (sequence: number, payload: unknown) => ({
  protocol: 'pane.layer-action.v1',
  binding,
  sequence,
  payload,
})

describe('Layer action event receiver', () => {
  it('buffers a result until completion and ignores duplicate events', () => {
    const receiver = new LayerActionEvents(binding)
    expect(receiver.receive(event(1, { type: 'accepted' }), binding)).toEqual({
      status: 'accepted',
    })
    expect(
      receiver.receive(event(2, { type: 'result', data }), binding),
    ).toEqual({ status: 'accepted' })
    expect(
      receiver.receive(event(2, { type: 'result', data }), binding),
    ).toEqual({ status: 'ignored' })
    expect(receiver.receive(event(3, { type: 'completed' }), binding)).toEqual({
      status: 'completed',
      data,
    })
    expect(receiver.receive(event(4, { type: 'accepted' }), binding)).toEqual({
      status: 'ignored',
    })
  })
  it('requires gap replay and does not accept completion without data', () => {
    const receiver = new LayerActionEvents(binding)
    expect(
      receiver.receive(event(2, { type: 'result', data }), binding),
    ).toEqual({ status: 'gap', after: 0 })
    expect(receiver.receive(event(1, { type: 'completed' }), binding)).toEqual({
      status: 'invalid',
    })
    expect(receiver.receive(event(1, { type: 'accepted' }), binding)).toEqual({
      status: 'accepted',
    })
    expect(receiver.receive(event(2, { type: 'completed' }), binding)).toEqual({
      status: 'invalid',
    })
  })
  it('does not render late data after local cancellation, revocation or navigation', () => {
    for (const current of [
      { ...binding, documentId: 'different' },
      { ...binding, routeEpoch: 1 },
      { ...binding, revocationGeneration: 1 },
    ]) {
      expect(
        new LayerActionEvents(binding).receive(
          event(1, { type: 'accepted' }),
          current,
        ),
      ).toEqual({ status: 'ignored' })
    }
    const receiver = new LayerActionEvents(binding)
    receiver.cancel()
    expect(receiver.receive(event(1, { type: 'accepted' }), binding)).toEqual({
      status: 'ignored',
    })
  })
  it('discards buffered data on failure', () => {
    const receiver = new LayerActionEvents(binding)
    receiver.receive(event(1, { type: 'accepted' }), binding)
    receiver.receive(event(2, { type: 'result', data }), binding)
    expect(
      receiver.receive(
        event(3, { type: 'failed', code: 'EXPIRED', retryable: false }),
        binding,
      ),
    ).toEqual({ status: 'failed', code: 'EXPIRED', retryable: false })
    expect(receiver.receive(event(4, { type: 'completed' }), binding)).toEqual({
      status: 'ignored',
    })
  })
})
