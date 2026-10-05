import { describe, expect, it } from 'bun:test'
import { createContext, runInContext } from 'node:vm'
import { userScriptBootstrap } from '../../entrypoints/background/layers/user-script-bootstrap'

function fixture() {
  const timers = new Set<() => void>()
  const location = { href: 'https://example.com/' }
  const instanceKey = `pane_layer_${'a'.repeat(32)}`
  let allowed = false
  class Events {
    addEventListener() {}
    removeEventListener() {}
  }
  class Activation {
    get isActive() {
      return false
    }
  }
  const context = createContext({
    location,
    crypto,
    EventTarget: Events,
    navigator: { userActivation: new Activation() },
    chrome: {
      runtime: { sendMessage: async () => ({ ok: allowed }) },
    },
    setInterval: (callback: () => void) => {
      timers.add(callback)
      return callback
    },
    clearInterval: (callback: () => void) => timers.delete(callback),
  })
  const inject = () =>
    runInContext(userScriptBootstrap('b'.repeat(64), instanceKey), context)
  inject()
  return {
    location,
    control: context[instanceKey],
    sdk: context.paneLayer,
    inject,
    allow: () => {
      allowed = true
    },
    tick: () => {
      for (const callback of timers) callback()
    },
    settle: async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    },
  }
}

describe('Layer bootstrap navigation', () => {
  for (const tickBeforeMount of [true, false]) {
    it(`can first activate after same-document navigation (timer first: ${tickBeforeMount})`, async () => {
      const f = fixture()
      await f.settle() // Initial hello is out of scope.
      f.location.href = 'https://example.com/intermediate'
      f.tick()
      f.location.href = 'https://example.com/posts/1'
      if (tickBeforeMount) f.tick()
      f.allow()
      f.inject() // Background mount pings the existing private world.
      await f.settle()
      expect(f.control.begin()).toBe(true)
      f.control.finish()
      f.tick()
      expect(f.control.state().stopped).toBe(false)
      expect(f.control.begin()).toBe(false) // Never replay mounted source.

      let cleaned = false
      f.sdk.onCleanup(() => {
        cleaned = true
      })
      f.location.href = 'https://example.com/elsewhere'
      f.tick()
      expect(cleaned).toBe(true)
      expect(f.control.state().stopped).toBe(true)
      expect(f.control.begin()).toBe(false)
    })
  }

  it('does not restart a bootstrap explicitly stopped before activation', async () => {
    const f = fixture()
    await f.settle()
    f.control.cleanup()
    f.location.href = 'https://example.com/posts/1'
    f.allow()
    f.inject()
    await f.settle()
    expect(f.control.begin()).toBe(false)
  })
})
