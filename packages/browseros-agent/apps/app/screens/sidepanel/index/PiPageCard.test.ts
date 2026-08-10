import { beforeEach, describe, expect, it, mock } from 'bun:test'

const storageState = new Map<string, unknown>()

mock.module('@wxt-dev/storage', () => ({
  storage: {
    getItem: async (key: string) => storageState.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
      storageState.set(key, value)
    },
  },
}))

const { markOpened, __resetPiPageCardAutoOpenForTests } = await import(
  './PiPageCard'
)

describe('PiPageCard markOpened', () => {
  beforeEach(() => {
    storageState.clear()
    __resetPiPageCardAutoOpenForTests()
  })

  it('opens the first time a key is seen', async () => {
    expect(await markOpened('msg-1-pi-tool-1')).toBe(true)
  })

  it('does not reopen the same key again within this mount', async () => {
    await markOpened('msg-1-pi-tool-1')
    expect(await markOpened('msg-1-pi-tool-1')).toBe(false)
  })

  it('does not reopen a key already marked by a prior side-panel mount', async () => {
    // Regression: the in-memory guard alone reset on every remount, and
    // window.sessionStorage did too (page-scoped, not extension-scoped),
    // so a conversation whose last message was a pi_open call re-navigated
    // every single time the panel was reopened. Extension session storage
    // (chrome.storage.session) must survive that.
    await markOpened('msg-1-pi-tool-1')
    __resetPiPageCardAutoOpenForTests() // simulate a fresh document mount

    expect(await markOpened('msg-1-pi-tool-1')).toBe(false)
  })
})
