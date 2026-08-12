import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  ConversationTurnAlreadyActiveError,
  ConversationTurnRegistry,
} from '../../src/agent/conversation-turn-registry'

function msg(id: string, text: string): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'text', text }],
  }
}

describe('ConversationTurnRegistry', () => {
  it('registers one running turn per conversation', () => {
    const registry = new ConversationTurnRegistry()
    const turn = registry.register('conv-1', { prompt: 'hi' })
    expect(turn.status).toBe('running')
    expect(registry.getActiveFor('conv-1')?.turnId).toBe(turn.turnId)
    expect(() => registry.register('conv-1')).toThrow(
      ConversationTurnAlreadyActiveError,
    )
  })

  it('keeps the turn running when a subscriber disconnects', async () => {
    const registry = new ConversationTurnRegistry()
    const turn = registry.register('conv-2')
    const ac = new AbortController()
    const stream = registry.subscribe(turn.turnId, { signal: ac.signal })
    expect(stream).not.toBeNull()
    ac.abort()
    expect(registry.getActiveFor('conv-2')?.status).toBe('running')
    registry.pushSnapshot(turn.turnId, [msg('a', 'hello')])
    registry.complete(turn.turnId, 'done')
    expect(registry.getActiveFor('conv-2')).toBeUndefined()
  })

  it('cancel aborts the turn controller and marks cancelled', () => {
    const registry = new ConversationTurnRegistry()
    const turn = registry.register('conv-3')
    expect(registry.cancel(turn.turnId, 'stop')).toBe(true)
    expect(turn.abortController.signal.aborted).toBe(true)
    expect(registry.getActiveFor('conv-3')).toBeUndefined()
    expect(registry.describe(turn.turnId)?.status).toBe('cancelled')
  })

  it('subscribe delivers snapshot frames then done', async () => {
    const registry = new ConversationTurnRegistry()
    const turn = registry.register('conv-4')
    registry.pushSnapshot(turn.turnId, [msg('a', 'one')])
    const stream = registry.subscribe(turn.turnId, { fromSeq: -1 })
    const reader = stream?.getReader()
    const first = await reader.read()
    expect(first.value?.event.type).toBe('snapshot')
    registry.complete(turn.turnId, 'done')
    // drain until done
    let sawDone = false
    for (let i = 0; i < 5; i++) {
      const next = await reader.read()
      if (next.done) break
      if (next.value?.event.type === 'done') {
        sawDone = true
        break
      }
    }
    expect(sawDone).toBe(true)
  })

  it('supports two subscribers; one disconnect leaves the turn alive', async () => {
    const registry = new ConversationTurnRegistry()
    const turn = registry.register('conv-5')
    const a = new AbortController()
    const streamA = registry.subscribe(turn.turnId, { signal: a.signal })
    const streamB = registry.subscribe(turn.turnId)
    expect(streamA).not.toBeNull()
    expect(streamB).not.toBeNull()
    a.abort()
    expect(registry.getActiveFor('conv-5')?.status).toBe('running')
    registry.pushSnapshot(turn.turnId, [msg('a', 'shared')])
    const reader = streamB?.getReader()
    const frame = await reader.read()
    expect(frame.value?.event.type).toBe('snapshot')
    registry.cancel(turn.turnId, 'cleanup')
  })

  it('cold attach with empty buffer uses seq -1 so the first real snapshot is seq 0', async () => {
    const registry = new ConversationTurnRegistry()
    const turn = registry.register('conv-6')
    const stream = registry.subscribe(turn.turnId, {
      fromSeq: -1,
      fallbackMessages: [msg('u', 'prompt')],
    })
    const reader = stream?.getReader()
    const cold = await reader.read()
    expect(cold.value?.seq).toBe(-1)
    expect(cold.value?.event.type).toBe('snapshot')

    registry.pushSnapshot(turn.turnId, [msg('a', 'first checkpoint')])
    const firstReal = await reader.read()
    expect(firstReal.value?.seq).toBe(0)
    expect(firstReal.value?.event.type).toBe('snapshot')
    if (firstReal.value?.event.type === 'snapshot') {
      expect(firstReal.value.event.messages[0]?.id).toBe('a')
    }
    registry.cancel(turn.turnId, 'cleanup')
  })
})
