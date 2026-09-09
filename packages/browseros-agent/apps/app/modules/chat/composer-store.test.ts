import { describe, expect, it } from 'bun:test'
import {
  composerKey,
  emptyComposer,
  recoverComposer,
  removeAcceptedDraft,
  settleQueuedMessage,
} from './composer-store'

describe('frontend queue settlement', () => {
  const state = () => ({
    ...emptyComposer(),
    paused: false,
    queue: [
      { id: 'a', message: { text: 'first' }, state: 'sending' as const },
      {
        id: 'b',
        message: { text: 'second' },
        state: 'queued' as const,
        waitsForSuccess: true,
      },
    ],
  })
  it('removes only the confirmed successful item and keeps FIFO order', () => {
    const before = state()
    const after = settleQueuedMessage(before, 'a', true)
    expect(after.queue.map((item) => item.id)).toEqual(['b'])
    expect(after.paused).toBe(false)
    expect(after.queue[0].waitsForSuccess).toBe(false)
    expect(before.queue).toHaveLength(2)
  })
  it('preserves uncertain delivery and pauses later instructions', () => {
    const after = settleQueuedMessage(state(), 'a', false)
    expect(after.paused).toBe(true)
    expect(after.queue[0]).toMatchObject({
      id: 'a',
      state: 'review',
      message: { text: 'first' },
    })
    expect(after.queue[1].state).toBe('queued')
  })
  it('does not undo an explicit pause when the current turn succeeds', () => {
    expect(
      settleQueuedMessage({ ...state(), paused: true }, 'a', true).paused,
    ).toBe(true)
  })
  it('isolates both conversation and target', () => {
    expect(composerKey('a', 'model')).not.toBe(composerKey('b', 'model'))
    expect(composerKey('a', 'model')).not.toBe(composerKey('a', 'agent'))
  })
})

describe('draft recovery', () => {
  it('makes interrupted sends reviewable immediately after reload', () => {
    const state = emptyComposer()
    state.queue = [
      { id: 'a', message: { text: 'maybe delivered' }, state: 'sending' },
    ]
    const recovered = recoverComposer(state)
    expect(recovered.paused).toBe(true)
    expect(recovered.queue[0].state).toBe('review')
    expect(state.queue[0].state).toBe('sending')
  })
  it('does not erase text edited while waiting for acceptance', () => {
    const sent = { ...emptyComposer().draft, text: 'original' }
    const current = { ...sent, text: 'new work' }
    expect(removeAcceptedDraft(current, sent)).toEqual(current)
  })
  it('clears accepted content but keeps newly added source context', () => {
    const sent = {
      ...emptyComposer().draft,
      text: 'original',
      tabs: [{ id: 1 } as chrome.tabs.Tab],
    }
    const current = {
      ...sent,
      tabs: [...sent.tabs, { id: 2 } as chrome.tabs.Tab],
    }
    expect(removeAcceptedDraft(current, sent)).toEqual({
      text: '',
      tabs: [{ id: 2 } as chrome.tabs.Tab],
      attachments: [],
    })
  })
})
