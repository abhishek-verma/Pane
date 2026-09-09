import { layerVersionDigest } from '@browseros/shared/layers/digest'
import {
  type InstalledLayer,
  installedLayerSchema,
} from '@browseros/shared/layers/manifest'
import { layerMatchesUrl } from '@browseros/shared/layers/matching'
import { z } from 'zod'
import { userScriptBootstrap } from './user-script-bootstrap'

const PREFIX = 'pane-layer-'
const MAX_LAYERS = 50 // Chromium allows 100 configured worlds per extension.
const recordSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/),
    instanceKey: z.string().regex(/^pane_layer_[a-f0-9]{32}$/),
    registrationId: z.string().regex(/^pane-layer-[a-f0-9]{32}$/),
    worldId: z.string().regex(/^pane-layer-[a-f0-9]{32}$/),
    layer: z.unknown(),
  })
  .strict()
type Registration = Omit<z.infer<typeof recordSchema>, 'layer'> & {
  layer: InstalledLayer
}
const messageSchema = z
  .object({
    channel: z.literal('pane.layers.script.v1'),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    instanceId: z.string().uuid(),
    kind: z.enum(['hello', 'resume', 'action']),
    payload: z.unknown().optional(),
    userGesture: z.boolean(),
  })
  .strict()
const actionSchema = z
  .object({ actionId: z.string().max(96), input: z.unknown() })
  .strict()

export interface ScriptDocument {
  tabId: number
  documentId: string
  instanceId: string
  url: string
}
export interface ScriptRunState extends ScriptDocument {
  layerId: string
  version: string
  status: 'starting' | 'executed' | 'failed' | 'reload-required'
  /** Arbitrary page mutations cannot be proven completely reversible. */
  reloadRequired: true
}
export interface ScriptRegistryOptions {
  profileId: string
  listen?: boolean
  /** Must read current grants/pause/preview state, not a script-supplied flag. */
  authorized(layer: InstalledLayer, document: ScriptDocument): boolean
  action?(
    layer: InstalledLayer,
    document: ScriptDocument,
    actionId: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown>
  browser?: Pick<
    typeof chrome,
    'runtime' | 'storage' | 'userScripts' | 'webNavigation' | 'tabs'
  >
}

function randomHex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
function registration(layer: InstalledLayer): Registration {
  const id = randomHex(16)
  return {
    token: randomHex(32),
    instanceKey: `pane_layer_${id}`,
    registrationId: PREFIX + id,
    worldId: PREFIX + id,
    layer,
  }
}
function versionKey(layer: InstalledLayer): string {
  return `${layer.id}:${layer.version}`
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error('Layer script did not finish within 5 seconds.')),
          5000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Extension-owned registry. Only trusted bootstraps are registered; actual
 * source is dispatched separately after native sender and live policy checks.
 * Engine availability alone never supplies this class with an enabled Layer.
 */
export class LayerUserScriptRegistry {
  private readonly browser: ScriptRegistryOptions['browser'] & {}
  private readonly key: string
  private readonly ready: Promise<void>
  private records = new Map<string, Registration>()
  private desired = new Map<string, InstalledLayer>()
  private states = new Map<string, ScriptRunState>()
  private running = new Map<
    AbortController,
    { record: Registration; document: ScriptDocument }
  >()
  private queue: Promise<void> = Promise.resolve()
  private generation = 0
  private initialized = false
  private disposed = false
  available = false

  constructor(private readonly options: ScriptRegistryOptions) {
    z.string().uuid().parse(options.profileId)
    this.browser = options.browser ?? chrome
    this.key = `pane.layers.scripts.${options.profileId}`
    this.ready = this.restore()
    if (options.listen !== false)
      this.browser.runtime.onUserScriptMessage?.addListener(this.listener)
  }

  private async restore() {
    const saved = (await this.browser.storage.local.get(this.key))[this.key]
    const parsed = z.array(recordSchema).max(MAX_LAYERS).safeParse(saved)
    if (!parsed.success) return
    for (const value of parsed.data) {
      const layer = installedLayerSchema.safeParse(value.layer)
      if (!layer.success || layer.data.definition.mode !== 'javascript')
        continue
      const item = { ...value, layer: layer.data }
      if (
        item.registrationId !== item.worldId ||
        item.instanceKey !== `pane_layer_${item.worldId.slice(PREFIX.length)}`
      )
        continue
      if (
        (await layerVersionDigest(item.layer.definition)) !== item.layer.version
      )
        continue
      if (
        [...this.records.values()].some(
          (old) =>
            old.token === item.token ||
            old.worldId === item.worldId ||
            versionKey(old.layer) === versionKey(item.layer),
        )
      )
        continue
      this.records.set(versionKey(item.layer), item)
    }
  }

  /** Replaces effective policy synchronously, before any browser/storage await.
   * Callers can start this without awaiting it when handling native Pause.
   */
  synchronize(values: InstalledLayer[]): Promise<void> {
    if (this.disposed)
      return Promise.reject(new Error('Script registry closed.'))
    const layers = values
      .map((value) => installedLayerSchema.parse(value))
      .filter((layer) => layer.definition.mode === 'javascript')
    if (
      layers.length > MAX_LAYERS ||
      new Set(layers.map(versionKey)).size !== layers.length
    )
      return Promise.reject(
        new Error(
          `At most ${MAX_LAYERS} distinct JavaScript Layer versions can be enabled or previewed.`,
        ),
      )
    this.desired = new Map(layers.map((layer) => [versionKey(layer), layer]))
    for (const [controller, run] of this.running)
      if (!this.allowed(run.record, run.document)) controller.abort()
    const generation = ++this.generation
    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        await this.ready
        if (this.disposed || generation !== this.generation) return
        try {
          for (const layer of layers)
            if ((await layerVersionDigest(layer.definition)) !== layer.version)
              throw new Error(
                'Layer source does not match its saved version hash.',
              )
          if (this.disposed || generation !== this.generation) return
          await this.reconcile(generation)
        } catch (error) {
          this.available = false
          for (const controller of this.running.keys()) controller.abort()
          throw error
        }
      })
    return this.queue
  }

  private async reconcile(generation: number) {
    const api = this.browser.userScripts
    if (!api || !this.browser.runtime.onUserScriptMessage)
      throw new Error('Native userscript access is unavailable.')
    const scripts = await api.getScripts()
    const oldWorlds = await api.getWorldConfigurations()
    if (generation !== this.generation || this.disposed) return
    this.available = true
    for (const [id, record] of this.records) {
      if (this.desired.has(id)) continue
      this.records.delete(id)
      this.stopRecord(record)
    }
    for (const layer of this.desired.values()) {
      if (!this.records.has(versionKey(layer)))
        this.records.set(versionKey(layer), registration(layer))
    }
    // Persist the private identity before installing bootstraps that use it.
    await this.browser.storage.local.set({
      [this.key]: [...this.records.values()],
    })
    if (generation !== this.generation || this.disposed) return
    const ids = new Set(
      [...this.records.values()].map((item) => item.registrationId),
    )
    const stale = scripts
      .filter((item) => item.id.startsWith(PREFIX) && !ids.has(item.id))
      .map((item) => item.id)
    if (stale.length) await api.unregister({ ids: stale })
    const worlds = new Set(
      [...this.records.values()].map((item) => item.worldId),
    )
    for (const world of oldWorlds) {
      if (world.worldId?.startsWith(PREFIX) && !worlds.has(world.worldId))
        await api.resetWorldConfiguration(world.worldId)
    }
    for (const item of this.records.values()) {
      if (generation !== this.generation || this.disposed) return
      const existing = scripts.find(
        (script) => script.id === item.registrationId,
      )
      const bootstrapCode = userScriptBootstrap(item.token, item.instanceKey)
      const exists = Boolean(existing)
      if (!this.initialized || !exists) {
        // Unchanged configureWorld does not re-send settings to every existing
        // renderer after extension reload in the supported Chromium build.
        await api.resetWorldConfiguration(item.worldId)
        await api.configureWorld({
          worldId: item.worldId,
          messaging: true,
          csp: "script-src 'self'; object-src 'none'",
        })
      }
      const bootstrapChanged =
        existing &&
        (existing.js?.length !== 1 || existing.js[0]?.code !== bootstrapCode)
      if (bootstrapChanged) await api.unregister({ ids: [item.registrationId] })
      if (!exists || bootstrapChanged) {
        const origin = new URL(item.layer.definition.scope.origin)
        await api.register([
          {
            id: item.registrationId,
            world: 'USER_SCRIPT',
            worldId: item.worldId,
            // Chromium patterns ignore ports. Exact origin/path/query/hash are
            // checked against the native document before injecting user source.
            matches: [`${origin.protocol}//${origin.hostname}/*`],
            runAt: 'document_idle',
            allFrames: false,
            js: [{ code: bootstrapCode }],
          },
        ])
      }
    }
    this.initialized = true
    this.available = true
  }

  private allowed(record: Registration, doc: ScriptDocument): boolean {
    return (
      this.available &&
      !this.disposed &&
      this.desired.has(versionKey(record.layer)) &&
      this.records.get(versionKey(record.layer)) === record &&
      layerMatchesUrl(record.layer.definition.scope, doc.url) &&
      this.options.authorized(record.layer, doc)
    )
  }

  private listener = (
    value: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (value: unknown) => void,
  ): boolean => {
    const parsed = messageSchema.safeParse(value)
    if (!parsed.success) return false
    void this.handle(parsed.data, sender).then(
      (value) => respond({ ok: true, value }),
      () =>
        respond({
          ok: false,
          error: 'This Layer request is unavailable or no longer authorized.',
        }),
    )
    return true
  }

  receive(
    value: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<unknown> {
    return this.handle(messageSchema.parse(value), sender)
  }

  async mount(
    layer: InstalledLayer,
    target: Pick<ScriptDocument, 'tabId' | 'documentId' | 'url'>,
  ): Promise<void> {
    await this.queue
    const record = this.records.get(versionKey(layer))
    const document = { ...target, instanceId: crypto.randomUUID() }
    const tab = await this.browser.tabs.get(target.tabId)
    const frame = await this.browser.webNavigation.getFrame({
      tabId: target.tabId,
      frameId: 0,
    })
    if (
      !record ||
      tab.incognito ||
      frame?.documentId !== target.documentId ||
      frame.url !== target.url ||
      frame.documentLifecycle !== 'active' ||
      !this.allowed(record, document)
    )
      throw new Error(
        'The script target is unavailable or no longer authorized.',
      )
    await this.evaluate(
      record,
      document,
      userScriptBootstrap(record.token, record.instanceKey),
    )
  }

  async executeGenerated(
    layer: InstalledLayer,
    target: Pick<ScriptDocument, 'tabId' | 'documentId' | 'url'>,
    source: string,
    actionId: string,
    current: () => boolean,
  ) {
    await this.queue
    const record = this.records.get(versionKey(layer))
    const state = this.states.get(`${target.documentId}:${layer.id}`)
    if (
      !record ||
      !record.layer.definition.actions.some(
        (action) => action.id === actionId && action.execution === 'javascript',
      ) ||
      !state ||
      state.version !== layer.version ||
      state.url !== target.url ||
      state.status !== 'executed' ||
      !this.allowed(record, state) ||
      !current()
    )
      throw new Error('Generated script document is unavailable.')
    const frame = await this.browser.webNavigation.getFrame({
      tabId: target.tabId,
      frameId: 0,
    })
    if (
      frame?.documentId !== target.documentId ||
      frame.url !== target.url ||
      frame.documentLifecycle !== 'active' ||
      !this.allowed(record, state) ||
      !current()
    )
      throw new Error('Generated script document changed.')
    await this.evaluate(record, state, source)
    if (
      !this.allowed(record, state) ||
      !current() ||
      this.states.get(`${target.documentId}:${layer.id}`) !== state
    )
      throw new Error('Generated script was revoked.')
  }

  async waitUntilExecuted(
    layer: InstalledLayer,
    target: Pick<ScriptDocument, 'tabId' | 'documentId' | 'url'>,
  ): Promise<void> {
    const deadline = Date.now() + 6000
    while (Date.now() < deadline) {
      const state = this.states.get(`${target.documentId}:${layer.id}`)
      if (state?.version === layer.version && state.url === target.url) {
        if (state.status === 'executed') return
        if (state.status === 'failed')
          throw new Error(
            'The script failed to initialize. Repair it and preview in a fresh tab.',
          )
        if (state.status === 'reload-required')
          throw new Error(
            'Reload this page or open it in a new tab before testing the changed script.',
          )
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(
      'The script did not initialize in time. Reload or open a fresh tab before retrying.',
    )
  }

  private async handle(
    message: z.infer<typeof messageSchema>,
    sender: chrome.runtime.MessageSender,
  ) {
    await this.ready
    if (
      sender.id !== this.browser.runtime.id ||
      sender.frameId !== 0 ||
      sender.tab?.id === undefined ||
      !sender.documentId ||
      sender.tab.incognito
    )
      throw new Error('Untrusted script sender.')
    const record = [...this.records.values()].find(
      (item) => item.token === message.token,
    )
    if (!record) throw new Error('Unknown script registration.')
    const frame = await this.browser.webNavigation.getFrame({
      tabId: sender.tab.id,
      frameId: 0,
    })
    if (
      !frame ||
      frame.documentId !== sender.documentId ||
      frame.url !== sender.url ||
      frame.documentLifecycle !== 'active'
    )
      throw new Error('Originating document changed.')
    const doc: ScriptDocument = {
      tabId: sender.tab.id,
      documentId: sender.documentId,
      url: frame.url,
      instanceId: message.instanceId,
    }
    if (!this.allowed(record, doc))
      throw new Error('Layer revoked or out of scope.')
    const key = `${doc.documentId}:${record.layer.id}`
    if (message.kind === 'hello' || message.kind === 'resume') {
      const previous = this.states.get(key)
      if (message.kind === 'resume') {
        if (!previous && this.states.size >= 1000)
          throw new Error('Too many active scripts.')
        const { previousInstanceId } = z
          .object({ previousInstanceId: z.string().uuid() })
          .strict()
          .parse(message.payload)
        if (
          previous &&
          (previous.version !== record.layer.version ||
            previous.instanceId !== previousInstanceId ||
            previous.status !== 'executed')
        )
          throw new Error('The cached script is no longer authorized.')
        // A BFCache restore retains source and lexical bindings. Prove the
        // live bootstrap changed its instance before adopting that state.
        const control = await this.evaluate(
          record,
          doc,
          `globalThis[${JSON.stringify(record.instanceKey)}]?.state()`,
        )
        const restored = z
          .object({
            instanceId: z.string().uuid(),
            stopped: z.literal(false),
            completed: z.literal(true),
          })
          .strict()
          .safeParse(control)
        if (
          !restored.success ||
          restored.data.instanceId !== doc.instanceId ||
          !this.allowed(record, doc)
        )
          throw new Error('The cached script bootstrap changed.')
        for (const [controller, run] of this.running)
          if (
            run.document.documentId === doc.documentId &&
            run.record.layer.id === record.layer.id
          )
            controller.abort()
        this.states.set(key, {
          ...doc,
          layerId: record.layer.id,
          version: record.layer.version,
          status: 'executed',
          reloadRequired: true,
        })
        return { accepted: true, reloadRequired: true }
      }
      if (
        previous &&
        (previous.version !== record.layer.version ||
          previous.instanceId !== doc.instanceId ||
          !['starting', 'executed'].includes(previous.status))
      )
        throw new Error('Reload this page before starting the changed Layer.')
      if (!this.states.has(key)) {
        if (this.states.size >= 1000)
          throw new Error('Too many active scripts.')
        const state: ScriptRunState = {
          ...doc,
          layerId: record.layer.id,
          version: record.layer.version,
          status: 'starting',
          reloadRequired: true,
        }
        this.states.set(key, state)
        // Never keep a message/UI response waiting on arbitrary page code.
        void this.start(record, state).catch(() => {
          if (state.status === 'starting') state.status = 'failed'
        })
      }
      return { accepted: true, reloadRequired: true }
    }
    const state = this.states.get(key)
    if (
      !state ||
      state.instanceId !== doc.instanceId ||
      state.version !== record.layer.version ||
      !['starting', 'executed'].includes(state.status)
    )
      throw new Error('Script instance unavailable; reload this page.')
    const request = actionSchema.parse(message.payload)
    const action = record.layer.definition.actions.find(
      (action) => action.id === request.actionId,
    )
    if (
      !action ||
      (action.kind !== 'data' &&
        (action.trigger !== 'click' || !message.userGesture)) ||
      !this.options.action
    )
      throw new Error('Action is not declared or requires a trusted click.')
    if (this.running.size >= 4)
      throw new Error('Too many active script actions.')
    const controller = new AbortController()
    this.running.set(controller, { record, document: doc })
    let aborted!: () => void
    const cancelled = new Promise<never>((_, reject) => {
      aborted = () => reject(new Error('Layer action cancelled.'))
      controller.signal.addEventListener('abort', aborted, { once: true })
    })
    const timer = setTimeout(() => controller.abort(), action.limits.deadlineMs)
    let result: unknown
    try {
      result = await Promise.race([
        this.options.action(
          record.layer,
          doc,
          action.id,
          request.input,
          controller.signal,
        ),
        cancelled,
      ])
    } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', aborted)
      this.running.delete(controller)
    }
    if (
      controller.signal.aborted ||
      !this.allowed(record, doc) ||
      this.states.get(key) !== state ||
      state.status === 'reload-required'
    )
      throw new Error('Layer changed while the action ran.')
    const current = await this.browser.webNavigation.getFrame({
      tabId: doc.tabId,
      frameId: 0,
    })
    if (
      current?.documentId !== doc.documentId ||
      current.url !== doc.url ||
      current.documentLifecycle !== 'active'
    )
      throw new Error('Originating page changed while the action ran.')
    return result
  }

  private async evaluate(
    record: Registration,
    doc: ScriptDocument,
    code: string,
  ) {
    const results = await bounded(
      this.browser.userScripts.execute({
        target: { tabId: doc.tabId, documentIds: [doc.documentId] },
        world: 'USER_SCRIPT',
        worldId: record.worldId,
        js: [{ code }],
      }),
    )
    if (
      results.length !== 1 ||
      results[0].documentId !== doc.documentId ||
      results[0].frameId !== 0 ||
      results[0].error
    )
      throw new Error('Script execution failed or its document changed.')
    return results[0].result
  }

  private async start(record: Registration, state: ScriptRunState) {
    const probe = await this.evaluate(
      record,
      state,
      `(()=>{const control=globalThis[${JSON.stringify(record.instanceKey)}];return control?{...control.state(),started:control.begin()}:null})()`,
    )
    if (!this.allowed(record, state) || state.status !== 'starting') return
    const parsed = z
      .object({
        instanceId: z.string().uuid(),
        stopped: z.boolean(),
        completed: z.boolean(),
        started: z.boolean(),
      })
      .strict()
      .safeParse(probe)
    if (!parsed.success || parsed.data.instanceId !== state.instanceId)
      throw new Error('The trusted bootstrap is missing.')
    if (
      parsed.data.stopped ||
      (!parsed.data.started && !parsed.data.completed)
    ) {
      state.status = 'reload-required'
      return
    }
    if (parsed.data.started) {
      // Separate compilation is essential: source cannot lexically access the
      // bootstrap token, and cannot escape a string wrapper to bypass begin().
      await this.evaluate(record, state, record.layer.definition.source ?? '')
      if (!this.allowed(record, state)) return
      await this.evaluate(
        record,
        state,
        `globalThis[${JSON.stringify(record.instanceKey)}]?.finish()`,
      )
    }
    if (this.allowed(record, state) && state.status === 'starting')
      state.status = 'executed'
  }

  private stopRecord(record: Registration) {
    for (const state of this.states.values()) {
      if (
        state.layerId !== record.layer.id ||
        state.version !== record.layer.version
      )
        continue
      state.status = 'reload-required'
      void this.evaluate(
        record,
        state,
        `globalThis[${JSON.stringify(record.instanceKey)}]?.cleanup()`,
      ).catch(() => undefined)
    }
    // Worker restart may have lost its list of live instances. Attempt cleanup
    // in every existing tab's private world without waiting for its renderer.
    void this.browser.tabs
      .query({})
      .then((tabs) => {
        for (const tab of tabs)
          if (
            tab.id !== undefined &&
            !tab.incognito &&
            tab.url?.startsWith('http')
          ) {
            void bounded(
              this.browser.userScripts.execute({
                target: { tabId: tab.id, frameIds: [0] },
                world: 'USER_SCRIPT',
                worldId: record.worldId,
                js: [
                  {
                    code: `globalThis[${JSON.stringify(record.instanceKey)}]?.cleanup()`,
                  },
                ],
              }),
            ).catch(() => undefined)
          }
      })
      .catch(() => undefined)
  }

  forgetTab(tabId: number) {
    for (const [controller, run] of this.running)
      if (run.document.tabId === tabId) controller.abort()
    for (const [key, state] of this.states)
      if (state.tabId === tabId) this.states.delete(key)
  }
  status(tabId?: number): ScriptRunState[] {
    return structuredClone(
      [...this.states.values()].filter(
        (state) => tabId === undefined || state.tabId === tabId,
      ),
    )
  }
  dispose() {
    this.disposed = true
    this.desired.clear()
    for (const controller of this.running.keys()) controller.abort()
    this.browser.runtime.onUserScriptMessage?.removeListener(this.listener)
    for (const record of this.records.values()) this.stopRecord(record)
  }
}
