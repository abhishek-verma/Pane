import {
  actionAcceptsInput,
  isPageTaskInput,
  isScriptTaskInput,
  type LayerActionBinding,
  layerActionBindingSchema,
  layerActionInputSchema,
  sameLayerActionBinding,
} from '@browseros/shared/layers/action-protocol'
import {
  type InstalledLayer,
  installedLayerSchema,
} from '@browseros/shared/layers/manifest'
import { scriptTaskExecutionSchema } from '@browseros/shared/layers/script-task'
import { z } from 'zod'
import { getBrowserProfileKey } from '@/lib/browseros/profile-key'
import { LayerActionEvents } from '@/lib/layers/action-events'
import { LayerRuntimeCache } from '@/lib/layers/cache'
import { documentHelloSchema, LAYER_CHANNEL } from '@/lib/layers/messages'
import { getLayerCredential, layerFetch } from '@/lib/layers/native'
import { loadProviders } from '@/lib/llm-providers/storage'
import { verifyLayerReload } from './layer-verification'
import {
  LayerUserScriptRegistry,
  type ScriptDocument,
} from './layers/user-script-registry'

interface DocumentRegistration {
  tabId: number
  documentId: string
  instanceId: string
  routeEpoch: number
  url: string
  title: string
  active: boolean
}
const commandSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum([
      'inspect',
      'preview',
      'verify',
      'clear',
      'probe-reload',
      'script-inspect',
      'script-execute',
    ]),
    tabId: z.number().int().nonnegative(),
    documentId: z.string(),
    instanceId: z.string().uuid(),
    routeEpoch: z.number().int().nonnegative(),
    payload: z.unknown().optional(),
    expiresAt: z.number(),
  })
  .strict()
const actionSchema = z
  .object({
    channel: z.literal(LAYER_CHANNEL),
    kind: z.literal('action-run'),
    invocationId: z.string().uuid(),
    snapshotId: z.string().uuid(),
    instanceId: z.string().uuid(),
    routeEpoch: z.number().int().nonnegative(),
    layerId: z.string().max(96),
    version: z.string().regex(/^[a-f0-9]{64}$/),
    actionId: z.string().max(96),
    input: z.unknown(),
  })
  .strict()
const cancelSchema = z
  .object({
    channel: z.literal(LAYER_CHANNEL),
    kind: z.literal('action-cancel'),
    invocationId: z.string().uuid(),
    instanceId: z.string().uuid(),
    routeEpoch: z.number().int().nonnegative(),
  })
  .strict()
const uiSchema = z
  .object({
    channel: z.literal(LAYER_CHANNEL),
    kind: z.literal('ui'),
    action: z.enum([
      'state',
      'disable',
      'enable',
      'pause',
      'site-pause',
      'keep',
      'delete',
      'restore',
      'version',
      'restore-version',
      'stop',
      'grant-preview',
    ]),
    id: z.string().max(96).optional(),
    origin: z.string().url().optional(),
    paused: z.boolean().optional(),
    revision: z.number().int().nonnegative().optional(),
    version: z.string().optional(),
    receiptId: z.string().uuid().optional(),
    invocationId: z.string().uuid().optional(),
  })
  .strict()

/** Only this extension-owned service worker has browser broker authority.
 * Content scripts can register their own actual sender document, never issue
 * UI mutations or forward arbitrary HTTP requests. */
export function layersBridge(): void {
  const sessionId = crypto.randomUUID()
  const documents = new Map<number, DocumentRegistration>()
  const reloadProbes = new Map<number, { layer: InstalledLayer; url: string }>()
  const readyProbeDocuments = new Map<number, string>()
  const previews = new Map<
    number,
    {
      layer: InstalledLayer
      expiresAt: number
      documentId: string
      instanceId: string
      routeEpoch: number
    }
  >()
  const previewTimers = new Map<number, ReturnType<typeof setTimeout>>()
  const invocations = new Map<
    string,
    { binding: LayerActionBinding; cancelled: boolean; mutatesPage: boolean }
  >()
  const completions = new Map<string, { result?: unknown; error?: string }>()
  let cache: LayerRuntimeCache | undefined
  let lastState: Record<string, unknown> = {}
  let online = false
  let pollAbort: AbortController | undefined
  let storageKey = ''
  let scripts: LayerUserScriptRegistry | undefined
  const ready = (async () => {
    const profileId = await getBrowserProfileKey()
    const key = `pane.layers.cache.${profileId}`
    storageKey = key
    // Chrome local storage is profile-isolated. Do not expose this key to pages.
    const stored = await chrome.storage.local.get(key)
    cache = new LayerRuntimeCache(profileId, stored[key])
    await syncScripts().catch(() => undefined)
    return key
  })()
  const persist = async () => {
    await ready
    if (cache)
      await chrome.storage.local.set({ [storageKey]: cache.serialize() })
  }
  const updateFor = (doc: DocumentRegistration) => ({
    channel: LAYER_CHANNEL,
    kind: 'update',
    instanceId: doc.instanceId,
    routeEpoch: doc.routeEpoch,
    layers:
      reloadProbes.get(doc.tabId)?.url === doc.url
        ? [
            ...(cache?.effective(doc.url) ?? []).filter(
              (layer) => layer.id !== reloadProbes.get(doc.tabId)?.layer.id,
            ),
            reloadProbes.get(doc.tabId)?.layer,
          ].filter((layer): layer is InstalledLayer => Boolean(layer))
        : (cache?.effective(doc.url) ?? []),
    paused: Boolean(
      cache?.serialize().paused ||
        cache?.serialize().manifest?.paused ||
        cache?.serialize().pausedOrigins.includes(new URL(doc.url).origin) ||
        cache
          ?.serialize()
          .manifest?.pausedOrigins.includes(new URL(doc.url).origin),
    ),
    disabledIds: cache?.serialize().disabledIds ?? [],
  })
  const broadcast = async () => {
    // Policy revocation starts synchronously. Native controls must not wait
    // for a blocked content renderer to acknowledge a cleanup message.
    void syncScripts()
      .then(() => {
        for (const doc of documents.values()) void mountScripts(doc)
      })
      .catch(() => undefined)
    void Promise.allSettled(
      [...documents.values()].map((doc) =>
        chrome.tabs.sendMessage(doc.tabId, updateFor(doc), {
          documentId: doc.documentId,
        }),
      ),
    )
  }
  const jsonRequest = async (
    path: string,
    input?: unknown,
    signal?: AbortSignal,
  ) => {
    const response = await layerFetch(path, {
      ...(input === undefined
        ? {}
        : { method: 'POST', body: JSON.stringify(input) }),
      signal,
    })
    const body = await response.json()
    if (!response.ok)
      throw Object.assign(new Error(body.error ?? 'Layers is unavailable.'), {
        status: response.status,
      })
    return body
  }
  const runAction = async (
    input: z.infer<typeof actionSchema>,
    doc: DocumentRegistration,
    signal?: AbortSignal,
  ) => {
    const tabId = doc.tabId
    if (!cache) throw new Error('Layers is unavailable.')
    if (invocations.size >= 4 || invocations.has(input.invocationId))
      throw new Error(
        'A Layer action is already running. Wait or cancel it first.',
      )
    const state = cache.serialize()
    const preview = previews.get(tabId)
    const reload = reloadProbes.get(tabId)
    const layer =
      cache
        .effective(doc.url)
        .find(
          (layer) =>
            layer.id === input.layerId && layer.version === input.version,
        ) ??
      (preview &&
      preview.expiresAt > Date.now() &&
      preview.documentId === doc.documentId &&
      preview.instanceId === doc.instanceId &&
      preview.routeEpoch === doc.routeEpoch &&
      preview.layer.id === input.layerId &&
      preview.layer.version === input.version
        ? preview.layer
        : reload &&
            reload.url === doc.url &&
            readyProbeDocuments.get(tabId) === doc.documentId &&
            reload.layer.id === input.layerId &&
            reload.layer.version === input.version
          ? reload.layer
          : undefined)
    if (
      !layer ||
      sitePaused(doc.url) ||
      state.pausedOrigins.includes(new URL(doc.url).origin) ||
      state.disabledIds.includes(input.layerId)
    )
      throw new Error('This Layer is disabled or no longer applies.')
    const action = layer.definition.actions.find(
      (action) => action.id === input.actionId,
    )
    const source = layerActionInputSchema.parse(input.input)
    if (!action || !actionAcceptsInput(action, source))
      throw new Error('The supplied input does not match the saved action.')
    const mutatesPage = isPageTaskInput(source) || isScriptTaskInput(source)
    if (
      mutatesPage &&
      [...invocations.values()].some(
        (run) => run.mutatesPage && run.binding.documentId === doc.documentId,
      )
    )
      throw new Error('Another page task is running on this document.')
    const binding: LayerActionBinding = {
      profileId: cache.profileId,
      invocationId: input.invocationId,
      snapshotId: input.snapshotId,
      layerId: layer.id,
      layerVersion: layer.version,
      actionId: action.id,
      tabId,
      frameId: 0,
      documentId: doc.documentId,
      instanceId: doc.instanceId,
      routeEpoch: doc.routeEpoch,
      revocationGeneration: state.manifest?.revision ?? 0,
    }
    const invocation = { binding, cancelled: false, mutatesPage }
    invocations.set(input.invocationId, invocation)
    const cancel = () => {
      invocation.cancelled = true
      void jsonRequest('/actions/cancel', binding).catch(() => undefined)
    }
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    try {
      const provider =
        action.kind === 'data'
          ? undefined
          : (await loadProviders()).find(
              (provider) => provider.id === action.providerId,
            )
      if (!provider && action.kind !== 'data')
        throw new Error(
          'The saved provider is missing. Configure it in Settings; no fallback was used.',
        )
      if (invocation.cancelled) throw new Error('Translation cancelled.')
      const result = await jsonRequest('/actions/run', {
        binding,
        input: source,
        config: provider
          ? {
              provider: provider.type,
              providerId: provider.id,
              model: provider.modelId,
              apiKey: provider.apiKey,
              baseUrl: provider.baseUrl,
              resourceName: provider.resourceName,
              region: provider.region,
              accessKeyId: provider.accessKeyId,
              secretAccessKey: provider.secretAccessKey,
              sessionToken: provider.sessionToken,
              reasoningEffort: provider.reasoningEffort,
            }
          : { provider: 'browseros', model: 'none' },
      }).catch((error) => {
        if (error instanceof Error && 'status' in error) throw error
        return jsonRequest('/actions/replay', { binding, after: 0 })
      })
      if (
        invocation.cancelled ||
        documents.get(tabId)?.documentId !== doc.documentId ||
        documents.get(tabId)?.routeEpoch !== doc.routeEpoch ||
        documents.get(tabId)?.instanceId !== doc.instanceId ||
        (!cache
          .effective(doc.url)
          .some(
            (item) => item.id === layer.id && item.version === layer.version,
          ) &&
          previews.get(tabId) !== preview)
      )
        throw new Error('The originating Layer changed.')
      return { binding, events: result.events as unknown[] }
    } finally {
      signal?.removeEventListener('abort', cancel)
      invocations.delete(input.invocationId)
    }
  }
  const sitePaused = (url: string) => {
    const state = cache?.serialize(),
      origin = new URL(url).origin
    return (
      !state ||
      state.paused ||
      state.manifest?.paused ||
      state.pausedOrigins.includes(origin) ||
      state.manifest?.pausedOrigins.includes(origin)
    )
  }
  const scriptAllowed = (layer: InstalledLayer, target: ScriptDocument) => {
    if (
      sitePaused(target.url) ||
      cache?.serialize().disabledIds.includes(layer.id)
    )
      return false
    const reload = reloadProbes.get(target.tabId)
    if (reload?.url === target.url && reload.layer.id === layer.id)
      return (
        reload.layer.version === layer.version &&
        readyProbeDocuments.get(target.tabId) === target.documentId
      )
    const preview = previews.get(target.tabId),
      document = documents.get(target.tabId)
    if (
      preview &&
      preview.expiresAt > Date.now() &&
      preview.documentId === target.documentId &&
      preview.instanceId === document?.instanceId &&
      preview.routeEpoch === document.routeEpoch &&
      preview.layer.id === layer.id
    )
      return preview.layer.version === layer.version
    return Boolean(
      cache
        ?.effective(target.url)
        .some((item) => item.id === layer.id && item.version === layer.version),
    )
  }
  async function syncScripts() {
    if (!cache) return
    if (!scripts)
      scripts = new LayerUserScriptRegistry({
        profileId: cache.profileId,
        listen: false,
        authorized: scriptAllowed,
        action: async (layer, target, actionId, input, signal) => {
          const doc = documents.get(target.tabId)
          if (
            !doc ||
            doc.documentId !== target.documentId ||
            doc.url !== target.url
          )
            throw new Error('The script document changed.')
          const reply = await runAction(
            {
              channel: LAYER_CHANNEL,
              kind: 'action-run',
              invocationId: crypto.randomUUID(),
              snapshotId: crypto.randomUUID(),
              instanceId: doc.instanceId,
              routeEpoch: doc.routeEpoch,
              layerId: layer.id,
              version: layer.version,
              actionId,
              input,
            },
            doc,
            signal,
          )
          const events = new LayerActionEvents(reply.binding)
          for (const event of reply.events) {
            const received = events.receive(event, reply.binding)
            if (received.status === 'completed') return received.data
            if (
              ['failed', 'cancelled', 'invalid', 'gap'].includes(
                received.status,
              )
            )
              throw new Error('The script action failed or was cancelled.')
          }
          throw new Error('No complete structured script result was received.')
        },
      })
    const layers = [...cache.scripts()]
    for (const preview of previews.values())
      if (
        preview.expiresAt > Date.now() &&
        preview.layer.definition.mode === 'javascript' &&
        !sitePaused(preview.layer.definition.scope.origin) &&
        !cache.serialize().disabledIds.includes(preview.layer.id)
      )
        layers.push(preview.layer)
    for (const probe of reloadProbes.values())
      if (
        probe.layer.definition.mode === 'javascript' &&
        !sitePaused(probe.url)
      )
        layers.push(probe.layer)
    await scripts.synchronize([
      ...new Map(
        layers.map((layer) => [`${layer.id}:${layer.version}`, layer]),
      ).values(),
    ])
  }
  const mountScripts = async (doc: DocumentRegistration) => {
    if (!scripts?.available) return
    const preview = previews.get(doc.tabId)
    const layers = [
      ...updateFor(doc).layers,
      ...(preview ? [preview.layer] : []),
    ]
    await Promise.allSettled(
      [
        ...new Map(
          layers
            .filter(
              (layer) =>
                layer.definition.mode === 'javascript' &&
                scriptAllowed(layer, doc),
            )
            .map((layer) => [`${layer.id}:${layer.version}`, layer]),
        ).values(),
      ].map((layer) => scripts!.mount(layer, doc)),
    )
  }
  const registerPreviewContext = async (
    layer: InstalledLayer,
    target: DocumentRegistration,
  ) => {
    const providers = (await loadProviders()).map(
      ({ id, type, modelId, updatedAt }) => ({
        id,
        type,
        model: modelId,
        updatedAt,
      }),
    )
    await jsonRequest('/poll', {
      sessionId,
      documents: [...documents.values()],
      javascript: scripts?.available ?? false,
      generatedScript: true,
      providers,
      revision: cache?.serialize().manifest?.revision ?? -1,
      wait: false,
    })
    await jsonRequest('/preview-context', {
      id: layer.id,
      version: layer.version,
      target,
    })
  }
  const setPreview = (doc: DocumentRegistration, layer: InstalledLayer) => {
    clearTimeout(previewTimers.get(doc.tabId))
    previews.set(doc.tabId, {
      layer,
      expiresAt: Date.now() + 5 * 60_000,
      documentId: doc.documentId,
      instanceId: doc.instanceId,
      routeEpoch: doc.routeEpoch,
    })
    previewTimers.set(
      doc.tabId,
      setTimeout(() => {
        previews.delete(doc.tabId)
        previewTimers.delete(doc.tabId)
        void broadcast()
      }, 5 * 60_000),
    )
  }
  chrome.runtime.onUserScriptMessage?.addListener(
    (message: unknown, sender, respond) => {
      if (
        !message ||
        typeof message !== 'object' ||
        (message as { channel?: unknown }).channel !== 'pane.layers.script.v1'
      )
        return false
      void ready
        .then(async () => {
          if (!scripts) throw new Error('Script runtime unavailable.')
          return scripts.receive(message, sender)
        })
        .then(
          (value) => respond({ ok: true, value }),
          () =>
            respond({
              ok: false,
              error:
                'This script request is unavailable or no longer authorized.',
            }),
        )
      return true
    },
  )
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false
    const hello = documentHelloSchema.safeParse(message)
    if (hello.success) {
      if (
        sender.frameId !== 0 ||
        sender.tab?.id === undefined ||
        !sender.documentId ||
        !sender.url?.startsWith('http')
      )
        return false
      const tabId = sender.tab.id
      const documentId = sender.documentId
      void (async () => {
        await ready
        const tab = await chrome.tabs.get(tabId)
        if (tab.url !== hello.data.url || sender.url !== hello.data.url)
          throw new Error('Page registration changed.')
        const previous = documents.get(tabId)
        if (
          previous?.instanceId === hello.data.instanceId &&
          previous.routeEpoch > hello.data.routeEpoch
        )
          throw new Error('Stale page registration.')
        const doc = {
          tabId,
          documentId,
          instanceId: hello.data.instanceId,
          routeEpoch: hello.data.routeEpoch,
          url: hello.data.url,
          title: hello.data.title,
          active: Boolean(tab.active),
        }
        documents.set(tabId, doc)
        if (
          !previous ||
          previous.documentId !== documentId ||
          previous.routeEpoch !== doc.routeEpoch
        )
          pollAbort?.abort()
        respond(updateFor(doc))
        void mountScripts(doc)
      })().catch(() =>
        respond({ error: 'This document is no longer current.' }),
      )
      return true
    }
    const actionInput = actionSchema.safeParse(message)
    const cancellation = cancelSchema.safeParse(message)
    if (actionInput.success || cancellation.success) {
      if (
        sender.frameId !== 0 ||
        sender.tab?.id === undefined ||
        !sender.documentId
      )
        return false
      const tabId = sender.tab.id
      const senderDocumentId = sender.documentId
      void (async () => {
        await ready
        const data = actionInput.success
          ? actionInput.data
          : cancellation.success
            ? cancellation.data
            : undefined
        const doc = documents.get(tabId)
        if (
          !data ||
          !doc ||
          doc.documentId !== senderDocumentId ||
          doc.instanceId !== data.instanceId ||
          doc.routeEpoch !== data.routeEpoch ||
          sender.url !== doc.url
        )
          throw new Error('The originating page changed.')
        if (cancellation.success) {
          const invocation = invocations.get(data.invocationId)
          if (
            invocation &&
            invocation.binding.documentId === senderDocumentId &&
            invocation.binding.instanceId === data.instanceId
          ) {
            invocation.cancelled = true
            await jsonRequest('/actions/cancel', invocation.binding)
          }
          respond({ cancelled: true })
          return
        }
        if (!actionInput.success) throw new Error('Invalid action.')
        respond(await runAction(actionInput.data, doc))
      })().catch((error) =>
        respond({
          error:
            error instanceof Error ? error.message : 'Layer action failed.',
        }),
      )
      return true
    }
    // Extension UI pages have no HTTP tab sender; sandboxed app frames are not
    // privileged. Validate the sender URL, not a claimed message origin.
    if (
      !sender.url?.startsWith(chrome.runtime.getURL('')) ||
      sender.url.includes('/sandbox')
    )
      return false
    const parsed = uiSchema.safeParse(message)
    if (!parsed.success) return false
    void (async () => {
      await ready
      const input = parsed.data
      if (input.action === 'stop') {
        const invocation = input.invocationId
          ? invocations.get(input.invocationId)
          : undefined
        if (!invocation)
          throw new Error('This run has already ended or disconnected.')
        invocation.cancelled = true
        respond(await jsonRequest('/actions/cancel', invocation.binding))
        return
      }
      if (input.action === 'version') {
        respond(
          await jsonRequest('/version', {
            id: input.id,
            ...(input.version ? { version: input.version } : {}),
          }),
        )
        return
      }
      if (input.action === 'state') {
        try {
          lastState = await jsonRequest('/state')
          online = true
        } catch {
          online = false
        }
        respond({
          ...lastState,
          online,
          local: cache?.serialize(),
          documents: [...documents.values()],
          scripts: scripts?.status() ?? [],
        })
        return
      }
      // Offline revocation is durable and immediate, before any network call.
      if (input.action === 'disable' || input.action === 'delete') {
        if (!input.id) throw new Error('Choose a Layer first.')
        cache?.disable(input.id)
      } else if (
        (input.action === 'pause' || input.action === 'site-pause') &&
        input.paused !== false
      ) {
        cache?.pause(
          true,
          input.action === 'site-pause' ? input.origin : undefined,
        )
      }
      await persist()
      await broadcast()
      const { channel: _channel, kind: _kind, ...mutation } = input
      try {
        const result = await jsonRequest('/mutate', mutation)
        if (cache?.accept(result.manifest) === 'invalid')
          throw new Error('Invalid Layer manifest.')
        if ((input.action === 'enable' || input.action === 'keep') && input.id)
          cache?.acknowledgeEnable(input.id, result.manifest.revision)
        if (
          (input.action === 'pause' || input.action === 'site-pause') &&
          input.paused === false
        )
          cache?.pause(
            false,
            input.action === 'site-pause' ? input.origin : undefined,
          )
        await persist()
        await broadcast()
        pollAbort?.abort()
        respond({ ok: true, manifest: result.manifest })
      } catch (error) {
        respond({
          error:
            error instanceof Error ? error.message : 'Layer change failed.',
          disabledLocally:
            input.action === 'disable' ||
            input.action === 'delete' ||
            (input.paused !== false &&
              ['pause', 'site-pause'].includes(input.action)),
        })
      }
    })().catch((error) =>
      respond({
        error: error instanceof Error ? error.message : 'Layer request failed.',
      }),
    )
    return true
  })
  chrome.tabs.onRemoved.addListener((tabId) => {
    documents.delete(tabId)
    readyProbeDocuments.delete(tabId)
    scripts?.forgetTab(tabId)
    previews.delete(tabId)
    clearTimeout(previewTimers.get(tabId))
    previewTimers.delete(tabId)
    void syncScripts().catch(() => undefined)
    pollAbort?.abort()
  })
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading') {
      documents.delete(tabId)
      scripts?.forgetTab(tabId)
      readyProbeDocuments.delete(tabId)
      pollAbort?.abort()
    }
  })
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    void chrome.tabs.query({ windowId }).then((tabs) => {
      for (const tab of tabs) {
        const doc = tab.id === undefined ? undefined : documents.get(tab.id)
        if (doc) doc.active = tab.id === tabId
      }
    })
  })
  const execute = async (value: unknown) => {
    const command = commandSchema.parse(value)
    let completion = completions.get(command.id)
    if (!completion) {
      try {
        const doc = documents.get(command.tabId)
        if (
          command.expiresAt <= Date.now() ||
          !doc ||
          doc.documentId !== command.documentId ||
          doc.instanceId !== command.instanceId ||
          doc.routeEpoch !== command.routeEpoch
        )
          throw new Error('The originating document changed.')
        if (
          command.kind === 'script-inspect' ||
          command.kind === 'script-execute'
        ) {
          const payload = command.payload as {
            binding: unknown
            layer: unknown
            execution?: unknown
          }
          const binding = layerActionBindingSchema.parse(payload.binding)
          const layer = installedLayerSchema.parse(payload.layer)
          const invocation = invocations.get(binding.invocationId)
          if (
            !scripts ||
            !invocation ||
            invocation.cancelled ||
            !sameLayerActionBinding(invocation.binding, binding) ||
            binding.layerId !== layer.id ||
            binding.layerVersion !== layer.version ||
            binding.documentId !== doc.documentId ||
            binding.routeEpoch !== doc.routeEpoch ||
            binding.instanceId !== doc.instanceId ||
            !scriptAllowed(layer, doc) ||
            !layer.definition.actions.some(
              (action) =>
                action.id === binding.actionId &&
                action.execution === 'javascript',
            )
          )
            throw new Error('Generated page task is no longer authorized.')
          const execution =
            command.kind === 'script-execute'
              ? scriptTaskExecutionSchema.parse(payload.execution)
              : undefined
          if (execution)
            await scripts.executeGenerated(
              layer,
              doc,
              execution.source,
              binding.actionId,
              () => !invocation.cancelled && documents.get(doc.tabId) === doc,
            )
          if (
            invocation.cancelled ||
            documents.get(doc.tabId) !== doc ||
            !scriptAllowed(layer, doc)
          )
            throw new Error('Generated page task was revoked.')
          const result = await chrome.tabs.sendMessage(
            doc.tabId,
            {
              channel: LAYER_CHANNEL,
              kind: 'command',
              command: execution ? 'script-check' : 'inspect',
              instanceId: doc.instanceId,
              routeEpoch: doc.routeEpoch,
              ...(execution ? { layer, execution } : {}),
            },
            { documentId: doc.documentId },
          )
          if (result?.error) throw new Error(result.error)
          completion = { result }
        } else {
          const layer = command.payload as InstalledLayer | undefined
          if (
            ['preview', 'probe-reload'].includes(command.kind) &&
            updateFor(doc).paused
          )
            throw new Error('Resume Layers on this site before previewing.')
          if (
            layer?.definition.mode === 'javascript' &&
            command.kind === 'preview'
          ) {
            await registerPreviewContext(layer, doc)
            setPreview(doc, layer)
            try {
              await syncScripts()
              if (!scripts?.available)
                throw new Error('Native script access is unavailable.')
              await scripts.mount(layer, doc)
              await scripts.waitUntilExecuted(layer, doc)
            } catch (error) {
              previews.delete(doc.tabId)
              clearTimeout(previewTimers.get(doc.tabId))
              previewTimers.delete(doc.tabId)
              await syncScripts().catch(() => undefined)
              throw error
            }
          }
          if (
            layer?.definition.mode === 'javascript' &&
            command.kind === 'verify'
          ) {
            if (!scripts) throw new Error('Script runtime unavailable.')
            await scripts.waitUntilExecuted(layer, doc)
          }
          const result =
            command.kind === 'probe-reload'
              ? await verifyLayerReload({
                  original: doc,
                  layer: layer as InstalledLayer,
                  documents,
                  probes: reloadProbes,
                  prepare:
                    layer?.definition.mode === 'javascript'
                      ? syncScripts
                      : undefined,
                  scriptReady: async (target, layer) => {
                    if (layer.definition.mode !== 'javascript') return
                    const current = documents.get(target.tabId)
                    if (
                      !current ||
                      current.documentId !== target.documentId ||
                      !scripts
                    )
                      throw new Error('Verification document changed.')
                    if (
                      readyProbeDocuments.get(target.tabId) !==
                      target.documentId
                    ) {
                      await registerPreviewContext(layer, current)
                      readyProbeDocuments.set(target.tabId, target.documentId)
                      await scripts.mount(layer, current)
                    }
                    await scripts.waitUntilExecuted(layer, current)
                  },
                })
              : await chrome.tabs.sendMessage(
                  doc.tabId,
                  {
                    channel: LAYER_CHANNEL,
                    kind: 'command',
                    command: command.kind,
                    instanceId: doc.instanceId,
                    routeEpoch: doc.routeEpoch,
                    ...(layer ? { layer } : {}),
                  },
                  { documentId: doc.documentId },
                )
          if (result?.error) throw new Error(result.error)
          if (command.kind === 'preview' && layer) setPreview(doc, layer)
          if (command.kind === 'clear') {
            previews.delete(doc.tabId)
            clearTimeout(previewTimers.get(doc.tabId))
            previewTimers.delete(doc.tabId)
            await syncScripts().catch(() => undefined)
          }
          completion = { result }
        }
      } catch (error) {
        completion = {
          error:
            error instanceof Error
              ? error.message.slice(0, 500)
              : 'Page operation failed.',
        }
      }
      completions.set(command.id, completion)
      if (completions.size > 128) {
        const oldest = completions.keys().next().value
        if (oldest) completions.delete(oldest)
      }
    }
    await jsonRequest('/complete', {
      sessionId,
      commandId: command.id,
      ...completion,
    })
  }
  const poll = async () => {
    await ready
    for (;;) {
      try {
        const credential = await getLayerCredential()
        if (cache?.profileId !== credential.profileId) {
          storageKey = `pane.layers.cache.${credential.profileId}`
          const stored = await chrome.storage.local.get(storageKey)
          cache = new LayerRuntimeCache(
            credential.profileId,
            stored[storageKey],
          )
          scripts?.dispose()
          scripts = undefined
          await broadcast()
        }
        await syncScripts().catch(() => undefined)
        pollAbort = new AbortController()
        const providers = (await loadProviders()).map(
          ({ id, type, modelId, updatedAt }) => ({
            id,
            type,
            model: modelId,
            updatedAt,
          }),
        )
        const result = await jsonRequest(
          '/poll',
          {
            sessionId,
            documents: [...documents.values()],
            javascript: scripts?.available ?? false,
            generatedScript: true,
            providers,
            revision: cache?.serialize().manifest?.revision ?? -1,
            wait: true,
          },
          pollAbort.signal,
        )
        online = true
        const accepted = cache?.accept(result.manifest)
        if (accepted === 'invalid') throw new Error('Invalid Layer manifest.')
        if (accepted === 'accepted') {
          await persist()
          await broadcast()
        }
        for (const command of result.commands) await execute(command)
      } catch {
        online = false
        if (!pollAbort?.signal.aborted)
          await new Promise((resolve) => setTimeout(resolve, 5000))
      }
    }
  }
  void poll().catch(() => {
    online = false
  })
}
