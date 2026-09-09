import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { dispatchNextComposerMessage } from './composer-dispatch'
import { type ComposerState, emptyComposer } from './composer-store'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// FIFO Web Locks test double; aborting a pending request never cancels its owner.
function testLocks() {
  const tails = new Map<string, Promise<void>>()
  return {
    async request(
      name: string,
      optionsOrCallback: unknown,
      callback?: () => unknown,
    ) {
      const work = (callback ?? optionsOrCallback) as () => unknown
      const signal = callback
        ? (optionsOrCallback as { signal?: AbortSignal }).signal
        : undefined
      const previous = tails.get(name) ?? Promise.resolve()
      const released = deferred()
      tails.set(
        name,
        previous.then(() => released.promise),
      )
      await previous
      try {
        signal?.throwIfAborted()
        return await work()
      } finally {
        released.resolve()
      }
    },
  }
}

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome')
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
let stored: Record<string, ComposerState>
const key = 'draft'
const sent: string[] = []
const options = () => ({
  key,
  dispatchKey: 'conversation',
  signal: new AbortController().signal,
  isCurrent: () => true,
  getSession: () => ({
    canSend: true,
    isRestoringConversation: false,
    lastTurnSucceeded: true,
    sendComposerMessage: async (message: { text: string }) => {
      sent.push(message.text)
      return 'done' as const
    },
  }),
})

beforeEach(() => {
  sent.length = 0
  stored = {
    [key]: {
      ...emptyComposer(),
      paused: false,
      queue: ['first', 'second'].map((text) => ({
        id: text,
        message: { text },
        state: 'queued',
      })),
    },
  }
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: testLocks(),
  })
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: structuredClone(stored[key]) }),
          set: async (value: Record<string, ComposerState>) => {
            Object.assign(stored, structuredClone(value))
          },
        },
      },
      tabs: { get: async () => ({ url: 'https://example.com/changed' }) },
    },
  })
})
afterEach(() => {
  if (originalChrome)
    Object.defineProperty(globalThis, 'chrome', originalChrome)
  else Reflect.deleteProperty(globalThis, 'chrome')
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks)
  else Reflect.deleteProperty(navigator, 'locks')
})

describe('frontend dispatch ownership', () => {
  it('hands off after a full turn even when another panel requests ownership before settlement', async () => {
    const started = deferred()
    const finish = deferred()
    const firstOptions = options()
    const first = dispatchNextComposerMessage({
      ...firstOptions,
      getSession: () => ({
        ...firstOptions.getSession(),
        sendComposerMessage: async (message) => {
          sent.push(message.text)
          started.resolve()
          await finish.promise
          return 'done'
        },
      }),
    })
    await started.promise
    const second = dispatchNextComposerMessage(options())
    expect(sent).toEqual(['first'])
    finish.resolve()
    await Promise.all([first, second])
    expect(sent).toEqual(['first', 'second'])
    expect(stored[key].queue).toEqual([])
  })

  it('cancels stale waiting effects without interrupting an accepted send', async () => {
    const started = deferred()
    const finish = deferred()
    const controller = new AbortController()
    const firstOptions = options()
    const first = dispatchNextComposerMessage({
      ...firstOptions,
      signal: controller.signal,
      getSession: () => ({
        ...firstOptions.getSession(),
        sendComposerMessage: async (message) => {
          sent.push(message.text)
          started.resolve()
          await finish.promise
          return 'done'
        },
      }),
    })
    await started.promise
    const stale = new AbortController()
    const waiting = dispatchNextComposerMessage({
      ...options(),
      signal: stale.signal,
    })
    controller.abort()
    stale.abort()
    finish.resolve()
    await Promise.all([first, waiting])
    expect(sent).toEqual(['first'])
    expect(stored[key].queue[0].id).toBe('second')
  })

  it('retains failed delivery and prevents a waiting panel from sending the next instruction', async () => {
    const firstOptions = options()
    await Promise.all([
      dispatchNextComposerMessage({
        ...firstOptions,
        getSession: () => ({
          ...firstOptions.getSession(),
          sendComposerMessage: async () => 'paused',
        }),
      }),
      dispatchNextComposerMessage(options()),
    ])
    expect(sent).toEqual([])
    expect(stored[key].paused).toBe(true)
    expect(stored[key].queue[0].state).toBe('review')
  })

  it('does not dispatch a queue belonging to a departed conversation', async () => {
    await dispatchNextComposerMessage({ ...options(), isCurrent: () => false })
    expect(sent).toEqual([])
    expect(stored[key].queue[0].state).toBe('queued')
  })

  it('requires review when a referenced page navigates', async () => {
    stored[key].queue[0].message.action = {
      id: 'action',
      timestamp: Date.now(),
      type: 'browseros',
      mode: 'agent',
      message: 'first',
      tabs: [
        {
          id: 1,
          title: 'Source',
          url: 'https://example.com/original',
        } as chrome.tabs.Tab,
      ],
    }
    await dispatchNextComposerMessage(options())
    expect(sent).toEqual([])
    expect(stored[key].queue[0].state).toBe('review')
    expect(stored[key].note).toContain('reattach')
  })
})
