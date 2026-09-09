import {
  type InstalledLayer,
  installedLayerSchema,
} from '@browseros/shared/layers/manifest'
import { layerMatchesUrl } from '@browseros/shared/layers/matching'
import { scriptTaskExecutionSchema } from '@browseros/shared/layers/script-task'
import { LayerDataEnrichment } from '@/lib/layers/enrichment'
import {
  LAYER_CHANNEL,
  pageCommandSchema,
  pageUpdateSchema,
} from '@/lib/layers/messages'
import { LayerPageActions } from '@/lib/layers/page-actions'
import {
  type LayerRuntimeStatus,
  ManagedLayerRuntime,
} from '@/lib/layers/runtime'
import { inspectScriptAssertions } from '@/lib/layers/script-assertions'

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  async main(ctx) {
    if (window.top !== window) return
    if ('prerendering' in document && document.prerendering) {
      let invalidated = false
      await new Promise<void>((resolve) => {
        const activate = () => resolve()
        document.addEventListener('prerenderingchange', activate, {
          once: true,
        })
        ctx.onInvalidated(() => {
          invalidated = true
          document.removeEventListener('prerenderingchange', activate)
          resolve()
        })
      })
      if (invalidated) return
    }
    const instanceId = crypto.randomUUID()
    let routeEpoch = 0
    let url = location.href
    let suspended = false
    let installed: InstalledLayer[] = []
    let preview: InstalledLayer | undefined
    let previewExpiry: ReturnType<typeof setTimeout> | undefined
    let statuses: LayerRuntimeStatus[] = []
    const actions = new LayerPageActions(() => ({ instanceId, routeEpoch }))
    const enrichment = new LayerDataEnrichment(() => ({
      instanceId,
      routeEpoch,
    }))
    const runtime = new ManagedLayerRuntime(document, {
      status: (value) => {
        statuses = value
      },
      data: (layer, operation, anchor) =>
        enrichment.attach(layer, operation, anchor),
      action: (layer, actionId, anchor) => actions.run(layer, actionId, anchor),
    })
    const effective = () =>
      preview
        ? [...installed.filter((layer) => layer.id !== preview?.id), preview]
        : installed
    const update = () => {
      const layers = suspended
        ? []
        : effective().filter((layer) => layer.definition.mode === 'managed')
      actions.update(layers)
      runtime.update(layers, location.href)
    }
    const clearPreview = () => {
      preview = undefined
      if (previewExpiry) clearTimeout(previewExpiry)
      update()
    }
    const hello = async () => {
      if (suspended) return
      try {
        const reply = await chrome.runtime.sendMessage({
          channel: LAYER_CHANNEL,
          kind: 'hello',
          instanceId,
          routeEpoch,
          url: location.href,
          title: document.title.slice(0, 300),
        })
        const parsed = pageUpdateSchema.safeParse(reply)
        if (
          parsed.success &&
          parsed.data.instanceId === instanceId &&
          parsed.data.routeEpoch === routeEpoch
        ) {
          if (
            parsed.data.paused ||
            (preview && parsed.data.disabledIds.includes(preview.id))
          )
            clearPreview()
          installed = parsed.data.paused
            ? []
            : parsed.data.layers.filter(
                (layer) => !parsed.data.disabledIds.includes(layer.id),
              )
          update()
        }
      } catch {
        /* Cached effects remain usable while the worker reconnects. */
      }
    }
    const route = () => {
      if (url === location.href) return
      url = location.href
      routeEpoch += 1
      actions.dispose()
      enrichment.completedActions.clear()
      clearPreview()
      // Drop old route effects immediately; never await network to clean up.
      update()
      void hello()
    }
    const listener = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      respond: (value: unknown) => void,
    ) => {
      if (sender.id !== chrome.runtime.id) return false
      const replacement = pageUpdateSchema.safeParse(message)
      if (replacement.success) {
        if (
          replacement.data.instanceId === instanceId &&
          replacement.data.routeEpoch === routeEpoch
        ) {
          if (
            replacement.data.paused ||
            (preview && replacement.data.disabledIds.includes(preview.id))
          )
            clearPreview()
          installed = replacement.data.paused
            ? []
            : replacement.data.layers.filter(
                (layer) => !replacement.data.disabledIds.includes(layer.id),
              )
          update()
        }
        return false
      }
      const parsed = pageCommandSchema.safeParse(message)
      if (!parsed.success) return false
      const command = parsed.data
      route()
      if (
        suspended ||
        command.instanceId !== instanceId ||
        command.routeEpoch !== routeEpoch
      ) {
        respond({ error: 'The originating page changed. Inspect it again.' })
        return false
      }
      try {
        if (command.command === 'clear') {
          clearPreview()
          respond({ cleared: true })
        } else if (command.command === 'inspect') {
          const candidates = Array.from(
            document.querySelectorAll(
              'main,article,section,aside,header,nav,h1,h2,h3,p,a[href],[id]',
            ),
          )
            .slice(0, 500)
            .filter(
              (node) =>
                !node.closest(
                  'form,input,textarea,select,[contenteditable],[data-pane-layer-owned]',
                ),
            )
            .map((node) => ({
              selector: node.id
                ? `#${CSS.escape(node.id)}`
                : node.tagName.toLowerCase() +
                  Array.from(node.classList)
                    .slice(0, 3)
                    .map((name) => `.${CSS.escape(name)}`)
                    .join(''),
              text: (node.textContent ?? '').trim().slice(0, 256),
              ...(node instanceof HTMLAnchorElement
                ? { href: node.href.slice(0, 2048) }
                : {}),
            }))
          respond({ url, instanceId, routeEpoch, candidates, statuses })
        } else {
          const layer = installedLayerSchema.parse(command.layer)
          if (!layerMatchesUrl(layer.definition.scope, location.href))
            throw new Error('This Layer does not apply to this page.')
          if (command.command === 'script-check') {
            const execution = scriptTaskExecutionSchema.parse(command.execution)
            respond({
              checks: inspectScriptAssertions(
                {
                  ...layer,
                  definition: {
                    ...layer.definition,
                    assertions: execution.assertions,
                  },
                },
                document,
              ),
            })
          } else if (command.command === 'preview') {
            clearPreview()
            preview = layer
            previewExpiry = setTimeout(clearPreview, 5 * 60_000)
            update()
            respond({
              preview: {
                id: layer.id,
                version: layer.version,
                expiresAt: Date.now() + 5 * 60_000,
              },
              statuses,
            })
          } else {
            if (
              (preview?.id !== layer.id || preview.version !== layer.version) &&
              !installed.some(
                (item) =>
                  item.id === layer.id && item.version === layer.version,
              )
            )
              throw new Error('Preview this exact version first.')
            if (layer.definition.mode === 'javascript') {
              const operations = inspectScriptAssertions(
                layer,
                document,
                command.command === 'verify-reload',
              )
              respond({
                id: layer.id,
                version: layer.version,
                instanceId,
                routeEpoch,
                url,
                checks: {
                  mounted: operations.every((item) => item.intact),
                  restored: false,
                  recovery: 'reload-required',
                  actionContract: true,
                },
                operations,
                reloadTested: false,
              })
              return false
            }
            // Compare the DOM after cleanup against its baseline with other
            // Layers still mounted. Verification observes actual interpreter work.
            runtime.update(
              installed.filter((item) => item.id !== layer.id),
              url,
            )
            const nodes = Array.from(
              new Set(
                layer.definition.operations.flatMap((operation) =>
                  Array.from(
                    document.querySelectorAll(operation.anchor.selector),
                  ),
                ),
              ),
            )
            if (nodes.length > 10_000)
              throw new Error('Verification target limit exceeded.')
            const baseline = nodes.map((node) => ({
              node,
              classes: node.getAttribute('class') ?? '',
            }))
            const ownedBefore = document.querySelectorAll(
              '[data-pane-layer-owned]',
            ).length
            update()
            const operations = runtime.inspect(layer.id)
            const mounted =
              operations.length === layer.definition.operations.length &&
              operations.every(
                (operation) =>
                  operation.intact && operation.affectedElements > 0,
              )
            runtime.update(
              installed.filter((item) => item.id !== layer.id),
              url,
            )
            const restored =
              baseline.every(
                ({ node, classes }) =>
                  node.isConnected &&
                  (node.getAttribute('class') ?? '') === classes,
              ) &&
              document.querySelectorAll('[data-pane-layer-owned]').length ===
                ownedBefore
            update()
            respond({
              id: layer.id,
              version: layer.version,
              instanceId,
              routeEpoch,
              url,
              checks: {
                mounted,
                restored,
                actionContract: layer.definition.actions.every((action) =>
                  (action.kind === 'data'
                    ? enrichment.completedActions
                    : actions.completedActions
                  ).has(`${layer.id}:${layer.version}:${action.id}`),
                ),
              },
              operations,
              reloadTested: false,
            })
          }
        }
      } catch (error) {
        respond({
          error:
            error instanceof Error ? error.message : 'Layer command failed.',
        })
      }
      return false
    }
    chrome.runtime.onMessage.addListener(listener)
    const pagehide = () => {
      suspended = true
      routeEpoch += 1
      actions.dispose()
      enrichment.completedActions.clear()
      clearPreview()
      update()
    }
    const pageshow = () => {
      suspended = false
      route()
      // A Layer may have been disabled while this document was in BFCache.
      // Restore from the current background manifest, not stale mounted state.
      void hello()
    }
    window.addEventListener('pagehide', pagehide)
    window.addEventListener('pageshow', pageshow)
    window.addEventListener('popstate', route)
    window.addEventListener('hashchange', route)
    // pushState does not emit a DOM event in the isolated world. A small local
    // URL check also detects silent router changes, without instrumenting site JS.
    const routeTimer = setInterval(route, 250)
    const reconnectTimer = setInterval(() => {
      void hello()
    }, 15_000)
    void hello()
    ctx.onInvalidated(() => {
      clearInterval(routeTimer)
      clearInterval(reconnectTimer)
      if (previewExpiry) clearTimeout(previewExpiry)
      chrome.runtime.onMessage.removeListener(listener)
      window.removeEventListener('pagehide', pagehide)
      window.removeEventListener('pageshow', pageshow)
      window.removeEventListener('popstate', route)
      window.removeEventListener('hashchange', route)
      actions.dispose()
      enrichment.completedActions.clear()
      enrichment.dispose()
      runtime.dispose()
    })
  },
})
