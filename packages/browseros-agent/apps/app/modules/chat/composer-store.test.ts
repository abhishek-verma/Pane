import { describe, expect, it } from 'bun:test'
import {
  composerKey,
  emptyComposer,
  migrateComposer,
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
  it('shares one queue across providers while isolating conversations', () => {
    expect(composerKey('a', 'model')).not.toBe(composerKey('b', 'model'))
    expect(composerKey('a', 'model')).toBe(composerKey('a', 'agent'))
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

describe('reopening shared queues', () => {
  it('continues pending messages without introducing a pause on every mount', () => {
    const state = {
      ...emptyComposer(),
      queue: [
        { id: 'next', message: { text: 'next' }, state: 'queued' as const },
      ],
    }
    expect(recoverComposer(state).paused).toBe(false)
  })
  it('keeps accepted turns for receipt reconciliation instead of retrying', () => {
    const state = {
      ...emptyComposer(),
      queue: [
        {
          id: 'active',
          message: { text: 'active' },
          state: 'sending' as const,
          started: { turnId: 'turn', conversationId: 'chat' },
        },
      ],
    }
    expect(recoverComposer(state).queue[0].state).toBe('sending')
    expect(recoverComposer(state).paused).toBe(false)
    expect(settleQueuedMessage(state, 'active', false).queue).toEqual([])
  })
})

describe('provider queue migration', () => {
  it('merges queues once without overwriting another view’s saved changes', async () => {
    const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome')
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
    const key = composerKey('chat')
    const values: Record<string, unknown> = {
      'chat-composer-v1:chat:model-a': {
        ...emptyComposer(),
        draft: { ...emptyComposer().draft, text: 'draft' },
        queue: [{ id: 'a', message: { text: 'first' }, state: 'queued' }],
      },
      'chat-composer-v1:chat:model-b': {
        ...emptyComposer(),
        queue: [{ id: 'b', message: { text: 'second' }, state: 'queued' }],
      },
      'chat-composer-v1:other:model-a': {
        ...emptyComposer(),
        queue: [
          { id: 'foreign', message: { text: 'other chat' }, state: 'queued' },
        ],
      },
    }
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          local: {
            getKeys: async () => Object.keys(values),
            get: async (keys: string | string[]) =>
              Object.fromEntries(
                (Array.isArray(keys) ? keys : [keys])
                  .filter((key) => values[key])
                  .map((key) => [key, values[key]]),
              ),
            set: async (next: Record<string, unknown>) => {
              Object.assign(values, next)
            },
          },
        },
      },
    })
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (_name: string, work: () => Promise<void>) => work(),
      },
    })
    try {
      await migrateComposer('chat')
      const migrated = values[key] as ReturnType<typeof emptyComposer>
      expect(migrated.queue.map((item) => item.id)).toEqual(['a', 'b'])
      expect(migrated.draft.text).toBe('draft')
      migrated.queue = []
      await migrateComposer('chat')
      expect((values[key] as ReturnType<typeof emptyComposer>).queue).toEqual(
        [],
      )
    } finally {
      if (originalChrome)
        Object.defineProperty(globalThis, 'chrome', originalChrome)
      else Reflect.deleteProperty(globalThis, 'chrome')
      if (originalLocks)
        Object.defineProperty(navigator, 'locks', originalLocks)
      else Reflect.deleteProperty(navigator, 'locks')
    }
  })
})
