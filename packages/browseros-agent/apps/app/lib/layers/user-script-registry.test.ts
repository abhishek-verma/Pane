import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { canonicalLayerJson } from '@browseros/shared/layers/digest'
import { installedLayerSchema } from '@browseros/shared/layers/manifest'
import {
  LayerUserScriptRegistry,
  type ScriptRegistryOptions,
} from '../../entrypoints/background/layers/user-script-registry'

const profileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const instanceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const layer = installedLayerSchema.parse({
  id: 'custom',
  version: 'a'.repeat(64),
  definition: {
    protocol: 'pane.layers.v1',
    name: 'Custom',
    intent: 'Add custom page UI',
    mode: 'javascript',
    scope: {
      origin: 'https://example.com:8443',
      paths: ['/posts/*'],
      query: { view: 'list' },
    },
    operations: [],
    source: 'document.body.dataset.testSource = "a";',
    actions: [
      {
        id: 'translate',
        kind: 'transform',
        trigger: 'click',
        instruction: 'Translate',
        targetLanguage: 'en',
        outputSchema: 'pane.translation.v1',
        providerId: 'test',
        limits: { maxSteps: 2, maxOutputTokens: 512, deadlineMs: 10000 },
      },
    ],
  },
})
const digest = (value: unknown) =>
  createHash('sha256').update(canonicalLayerJson(value)).digest('hex')
layer.version = digest(layer.definition)
const url = 'https://example.com:8443/posts/1?view=list'
type Listener = (
  value: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: any) => void,
) => boolean
function fixture() {
  const stored: Record<string, any> = {}
  const scripts = new Map<string, any>()
  const worlds = new Map<string, any>()
  const listeners = new Set<Listener>()
  const sources: string[] = []
  const executions: any[] = []
  const started = new Set<string>()
  let bootstrapInstanceId = instanceId
  const frame = { documentId: 'document-one', url, documentLifecycle: 'active' }
  let gate: Promise<void> = Promise.resolve()
  const browser = {
    runtime: {
      id: 'pane-extension',
      onUserScriptMessage: {
        addListener: (fn: Listener) => listeners.add(fn),
        removeListener: (fn: Listener) => listeners.delete(fn),
      },
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: structuredClone(stored[key]) }),
        set: async (value: any) => {
          Object.assign(stored, structuredClone(value))
        },
      },
    },
    webNavigation: { getFrame: async () => ({ ...frame }) },
    tabs: { query: async () => [{ id: 7, url: frame.url }] },
    userScripts: {
      getScripts: async () => {
        await gate
        return [...scripts.values()]
      },
      getWorldConfigurations: async () => [...worlds.values()],
      resetWorldConfiguration: async (id: string) => {
        worlds.delete(id)
      },
      configureWorld: async (value: any) => {
        worlds.set(value.worldId, value)
      },
      register: async (values: any[]) => {
        for (const value of values) scripts.set(value.id, value)
      },
      unregister: async ({ ids }: any) => {
        for (const id of ids) scripts.delete(id)
      },
      execute: async (args: any) => {
        executions.push(args)
        const code = args.js[0].code
        const key = args.worldId + frame.documentId
        let result: unknown
        if (code.includes('control.begin()')) {
          result = {
            started: !started.has(key),
            completed: started.has(key),
            stopped: false,
            instanceId: bootstrapInstanceId,
          }
          started.add(key)
        } else if (code.includes('?.state()')) {
          result = {
            instanceId: bootstrapInstanceId,
            stopped: false,
            completed: started.has(key),
          }
        } else if (
          !code.includes('?.cleanup()') &&
          !code.includes('?.finish()')
        ) {
          sources.push(code)
        }
        return [{ documentId: frame.documentId, frameId: 0, result }]
      },
    },
  }
  const options: ScriptRegistryOptions = {
    profileId,
    authorized: () => true,
    browser: browser as unknown as ScriptRegistryOptions['browser'],
    action: async () => ({ translated: true }),
  }
  const create = () => new LayerUserScriptRegistry(options)
  const record = () => stored[`pane.layers.scripts.${profileId}`][0]
  const sender = () =>
    ({
      id: 'pane-extension',
      frameId: 0,
      tab: { id: 7 },
      documentId: frame.documentId,
      url: frame.url,
    }) as chrome.runtime.MessageSender
  const message = (kind = 'hello', overrides: any = {}) => ({
    channel: 'pane.layers.script.v1',
    token: record().token,
    instanceId,
    kind,
    userGesture: true,
    ...overrides,
  })
  const send = (value = message(), from = sender()): Promise<any> =>
    new Promise((resolve) => {
      let handled = false
      for (const fn of listeners) handled = fn(value, from, resolve) || handled
      if (!handled) resolve({ ok: false })
    })
  const action = (overrides: any = {}) =>
    send(
      message('action', {
        payload: { actionId: 'translate', input: {} },
        ...overrides,
      }),
    )
  const settled = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }
  return {
    create,
    record,
    send,
    message,
    sender,
    action,
    settled,
    options,
    browser,
    frame,
    scripts,
    worlds,
    stored,
    sources,
    executions,
    listeners,
    restoreInstance: (value: string) => {
      bootstrapInstanceId = value
    },
    hold: (value: Promise<void>) => {
      gate = value
    },
  }
}

describe('private userscript registry', () => {
  it('refreshes an older registered bootstrap without rotating identity or replaying mounted source', async () => {
    const f = fixture(),
      registry = f.create()
    await registry.synchronize([layer])
    await f.send()
    await f.settled()
    const record = f.record(),
      saved = f.scripts.get(record.registrationId)
    saved.js = [{ code: '/* older extension bootstrap */' }]
    await registry.synchronize([layer])
    expect(f.record().token).toBe(record.token)
    expect(f.scripts.get(record.registrationId).js[0].code).toContain(
      'previousInstanceId',
    )
    expect(f.sources).toEqual([layer.definition.source!])
    registry.dispose()
  })
  it('re-attests a restored instance without replaying source and cancels old instance work', async () => {
    const f = fixture(),
      registry = f.create()
    await registry.synchronize([layer])
    expect((await f.send()).ok).toBe(true)
    await f.settled()
    let release!: (value: unknown) => void
    f.options.action = async () =>
      new Promise((resolve) => {
        release = resolve
      })
    const pending = f.action()
    await f.settled()
    const next = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    f.restoreInstance(next)
    expect(
      (
        await f.send(
          f.message('resume', {
            instanceId: next,
            payload: { previousInstanceId: instanceId },
          }),
        )
      ).ok,
    ).toBe(true)
    expect((await pending).ok).toBe(false)
    release({ translated: true })
    expect(f.sources).toEqual([layer.definition.source!])
    expect(registry.status(7)[0]).toMatchObject({
      status: 'executed',
      instanceId: next,
    })
    expect((await f.action()).ok).toBe(false)
    registry.dispose()
  })
  it('rejects restored claims that do not match the active native document and live bootstrap', async () => {
    const f = fixture(),
      registry = f.create()
    await registry.synchronize([layer])
    await f.send()
    await f.settled()
    const next = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const resume = () =>
      f.message('resume', {
        instanceId: next,
        payload: { previousInstanceId: instanceId },
      })
    expect((await f.send(resume())).ok).toBe(false)
    f.restoreInstance(next)
    f.frame.documentLifecycle = 'cached'
    expect((await f.send(resume())).ok).toBe(false)
    f.frame.documentLifecycle = 'active'
    expect(
      (
        await f.send(
          f.message('resume', {
            instanceId: next,
            payload: { previousInstanceId: next },
          }),
        )
      ).ok,
    ).toBe(false)
    const oldMessage = resume()
    await registry.synchronize([])
    expect((await f.send(oldMessage)).ok).toBe(false)
    registry.dispose()
  })
  it('recovers a retained script world after worker state loss without executing source again', async () => {
    const f = fixture(),
      first = f.create()
    await first.synchronize([layer])
    await f.send()
    await f.settled()
    f.listeners.clear()
    const next = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    f.restoreInstance(next)
    const recovered = f.create()
    await recovered.synchronize([layer])
    expect(
      (
        await f.send(
          f.message('resume', {
            instanceId: next,
            payload: { previousInstanceId: instanceId },
          }),
        )
      ).ok,
    ).toBe(true)
    expect(f.sources).toEqual([layer.definition.source!])
    expect(recovered.status(7)[0]).toMatchObject({
      status: 'executed',
      instanceId: next,
    })
    recovered.dispose()
  })
  it('rejects changed source under an old immutable version hash', async () => {
    const f = fixture(),
      registry = f.create()
    await expect(
      registry.synchronize([
        {
          ...layer,
          definition: {
            ...layer.definition,
            source: 'throw new Error("tampered")',
          },
        },
      ]),
    ).rejects.toThrow('version hash')
    expect(f.scripts.size).toBe(0)
    expect(registry.available).toBe(false)
    registry.dispose()
  })
  it('does not trust a corrupted source restored from extension storage', async () => {
    const f = fixture(),
      first = f.create()
    await first.synchronize([layer])
    const old = f.message()
    f.stored[`pane.layers.scripts.${profileId}`][0].layer.definition.source =
      'throw new Error("tampered")'
    f.listeners.clear()
    const restarted = f.create()
    await restarted.synchronize([layer])
    expect((await f.send(old)).ok).toBe(false)
    expect((await f.send()).ok).toBe(true)
    await f.settled()
    expect(f.sources).toEqual([layer.definition.source!])
    restarted.dispose()
  })
  it('keeps active and preview versions isolated by document without replacing the active registration', async () => {
    const f = fixture(),
      registry = f.create()
    const next = {
      ...layer,
      definition: {
        ...layer.definition,
        source: 'document.body.dataset.preview = "yes";',
      },
    }
    next.version = digest(next.definition)
    f.options.authorized = (item, doc) =>
      item.version ===
      (doc.documentId === 'preview-document' ? next.version : layer.version)
    await registry.synchronize([layer, next])
    const originalToken = f.record().token
    expect((await f.send()).ok).toBe(true)
    await f.settled()
    f.frame.documentId = 'preview-document'
    const preview = f.stored[`pane.layers.scripts.${profileId}`].find(
      (item: any) => item.layer.version === next.version,
    )
    expect((await f.send()).ok).toBe(false)
    expect(
      (await f.send(f.message('hello', { token: preview.token }))).ok,
    ).toBe(true)
    await f.settled()
    expect(f.sources).toEqual([
      layer.definition.source!,
      next.definition.source,
    ])
    await registry.synchronize([layer])
    expect(f.scripts.size).toBe(1)
    expect(f.record().token).toBe(originalToken)
    f.frame.documentId = 'document-one'
    expect((await f.action()).ok).toBe(true)
    registry.dispose()
  })
  it('registers only trusted bootstrap source and separately executes in the exact native document', async () => {
    const f = fixture(),
      registry = f.create()
    await registry.synchronize([layer])
    expect([...f.scripts.values()][0].js[0].code).not.toContain(
      layer.definition.source,
    )
    expect((await f.send()).ok).toBe(true)
    await f.settled()
    expect(f.sources).toEqual([layer.definition.source!])
    expect(f.executions[0].target).toEqual({
      tabId: 7,
      documentIds: ['document-one'],
    })
    expect(registry.status()[0]).toMatchObject({
      status: 'executed',
      reloadRequired: true,
    })
    registry.dispose()
  })
  it('enforces exact port, path and query despite broad Chromium match patterns', async () => {
    const f = fixture(),
      registry = f.create()
    await registry.synchronize([layer])
    for (const wrong of [
      'https://example.com/posts/1?view=list',
      'https://example.com:8443/admin?view=list',
      'https://example.com:8443/posts/1?view=grid',
    ]) {
      f.frame.url = wrong
      expect((await f.send()).ok).toBe(false)
    }
    expect(f.sources).toHaveLength(0)
    registry.dispose()
  })
  it('rejects forged registrations, frames, incognito and stale native documents', async () => {
    const f = fixture(),
      registry = f.create()
    await registry.synchronize([layer])
    expect(
      (await f.send(f.message('hello', { token: '0'.repeat(64) }))).ok,
    ).toBe(false)
    for (const overrides of [
      { frameId: 1 },
      { id: 'other-extension' },
      { documentId: 'stale' },
      { tab: { id: 7, incognito: true } },
    ])
      expect(
        (
          await f.send(f.message(), {
            ...f.sender(),
            ...overrides,
          } as chrome.runtime.MessageSender)
        ).ok,
      ).toBe(false)
    f.frame.documentLifecycle = 'cached'
    expect((await f.send()).ok).toBe(false)
    expect(f.sources).toHaveLength(0)
    registry.dispose()
  })
  it('requires a declared action and attested user activation for model calls', async () => {
    const f = fixture(),
      registry = f.create()
    await registry.synchronize([layer])
    await f.send()
    await f.settled()
    expect((await f.action({ userGesture: false })).ok).toBe(false)
    expect(
      (await f.action({ payload: { actionId: 'undeclared', input: {} } })).ok,
    ).toBe(false)
    expect(await f.action()).toEqual({ ok: true, value: { translated: true } })
    registry.dispose()
  })
  it('revokes immediately even while a browser reconciliation call is waiting', async () => {
    const f = fixture(),
      registry = f.create()
    await registry.synchronize([layer])
    await f.send()
    await f.settled()
    let release!: () => void
    f.hold(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const disabling = registry.synchronize([])
    expect((await f.action()).ok).toBe(false)
    release()
    await disabling
    expect(f.scripts.size).toBe(0)
    expect(registry.status()[0].status).toBe('reload-required')
    registry.dispose()
  })
  it('discards a completed result after disable or navigation', async () => {
    for (const change of ['disable', 'navigate']) {
      const f = fixture(),
        registry = f.create()
      await registry.synchronize([layer])
      await f.send()
      await f.settled()
      let finish!: (value: unknown) => void, began!: () => void
      const entered = new Promise<void>((resolve) => {
        began = resolve
      })
      let signal: AbortSignal | undefined
      f.options.action = async (_layer, _doc, _id, _input, abortSignal) => {
        signal = abortSignal
        began()
        return new Promise((resolve) => {
          finish = resolve
        })
      }
      const pending = f.action()
      await entered
      if (change === 'disable') await registry.synchronize([])
      else f.frame.url = 'https://example.com:8443/posts/2?view=list'
      if (change === 'disable') expect(signal?.aborted).toBe(true)
      finish({ translated: true })
      expect((await pending).ok).toBe(false)
      registry.dispose()
    }
  })
  it('restores private identity after worker loss without executing the same document twice', async () => {
    const f = fixture(),
      first = f.create()
    await first.synchronize([layer])
    await f.send()
    await f.settled()
    const before = f.record()
    f.listeners.clear() // abrupt worker loss, without running its cleanup
    const restarted = f.create()
    await restarted.synchronize([layer])
    await f.send()
    await f.settled()
    expect(f.record()).toEqual(before)
    expect(f.sources).toHaveLength(1)
    expect((await f.action()).ok).toBe(true)
    restarted.dispose()
  })
  it('restores cleared Chromium registrations and worlds, and runs again on a fresh document', async () => {
    const f = fixture(),
      first = f.create()
    await first.synchronize([layer])
    await f.send()
    await f.settled()
    const before = f.record()
    f.listeners.clear()
    f.scripts.clear()
    f.worlds.clear()
    f.frame.documentId = 'document-two'
    const restarted = f.create()
    await restarted.synchronize([layer])
    await f.send()
    await f.settled()
    expect(f.record()).toEqual(before)
    expect(f.scripts.size).toBe(1)
    expect(f.worlds.size).toBe(1)
    expect(f.sources).toHaveLength(2)
    restarted.dispose()
  })
  it('rotates identity on version change and requires reload when an old version already ran', async () => {
    const f = fixture(),
      registry = f.create()
    await registry.synchronize([layer])
    await f.send()
    await f.settled()
    const old = f.message()
    const next = {
      ...layer,
      version: 'b'.repeat(64),
      definition: {
        ...layer.definition,
        source: 'document.body.dataset.testSource = "b";',
      },
    }
    next.version = digest(next.definition)
    await registry.synchronize([next])
    expect(f.record().token).not.toBe(old.token)
    expect((await f.send(old)).ok).toBe(false)
    expect((await f.send()).ok).toBe(false)
    f.frame.documentId = 'new-document'
    expect((await f.send()).ok).toBe(true)
    await f.settled()
    expect(f.sources).toEqual([
      layer.definition.source!,
      next.definition.source,
    ])
    registry.dispose()
  })
  it('does not remove registrations or world configurations belonging to another feature', async () => {
    const f = fixture(),
      registry = f.create()
    f.scripts.set('other-feature', { id: 'other-feature' })
    f.worlds.set('other-world', { worldId: 'other-world', messaging: false })
    await registry.synchronize([layer])
    await registry.synchronize([])
    expect([...f.scripts.keys()]).toEqual(['other-feature'])
    expect([...f.worlds.keys()]).toEqual(['other-world'])
    registry.dispose()
  })
})

it('binds generated execution to a declared action and rechecks cancellation after native frame lookup', async () => {
  const f = fixture(),
    registry = f.create()
  const generated = installedLayerSchema.parse({
    ...layer,
    definition: {
      ...layer.definition,
      actions: [
        {
          id: 'adapt',
          kind: 'page-task',
          execution: 'javascript',
          trigger: 'click',
          instruction: 'Adapt',
          outputSchema: 'pane.script-task-receipt.v1',
          providerId: 'test',
          limits: { maxSteps: 3, maxOutputTokens: 1000, deadlineMs: 10000 },
        },
      ],
    },
  })
  generated.version = digest(generated.definition)
  await registry.synchronize([generated])
  await f.send()
  await f.settled()
  const target = { tabId: 7, documentId: f.frame.documentId, url }
  const code = 'document.body.dataset.generated = "yes";'
  await expect(
    registry.executeGenerated(generated, target, code, 'other', () => true),
  ).rejects.toThrow('unavailable')
  await registry.executeGenerated(generated, target, code, 'adapt', () => true)
  const originalSource = generated.definition.source
  if (!originalSource) throw new Error('Missing fixture source')
  expect(f.sources).toEqual([originalSource, code])
  let active = true
  f.browser.webNavigation.getFrame = async () => {
    active = false
    return { ...f.frame }
  }
  await expect(
    registry.executeGenerated(generated, target, code, 'adapt', () => active),
  ).rejects.toThrow('changed')
  expect(f.sources).toHaveLength(2)
  registry.dispose()
})
