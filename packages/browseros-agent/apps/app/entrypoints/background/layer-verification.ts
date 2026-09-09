import type { InstalledLayer } from '@browseros/shared/layers/manifest'
import { LAYER_CHANNEL } from '@/lib/layers/messages'

export interface VerificationDocument {
  tabId: number
  documentId: string
  instanceId: string
  routeEpoch: number
  url: string
}

/** Verify reload on a temporary tab. Never reload a user's page, change its
 * focus, or lose an unsaved form. Only this temporary tab receives a probe
 * override, and it is closed on success, timeout, navigation or failure. */
export async function verifyLayerReload(options: {
  original: VerificationDocument
  layer: InstalledLayer
  documents: Map<number, VerificationDocument>
  probes: Map<number, { layer: InstalledLayer; url: string }>
  prepare?: () => Promise<void>
  scriptReady?: (
    document: VerificationDocument,
    layer: InstalledLayer,
  ) => Promise<void>
}) {
  const temporary = await chrome.tabs.create({
    url: options.original.url,
    active: false,
  })
  if (temporary.id === undefined)
    throw new Error('Could not open a Layer verification tab.')
  const tabId = temporary.id
  options.probes.set(tabId, { layer: options.layer, url: options.original.url })
  const waitForDocument = async (
    previousId?: string,
  ): Promise<VerificationDocument> => {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const doc = options.documents.get(tabId)
      if (doc && doc.documentId !== previousId) {
        if (doc.url !== options.original.url)
          throw new Error(
            'The verification page redirected. Verify the final route explicitly.',
          )
        return doc
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('The verification page did not load within its time limit.')
  }
  try {
    await options.prepare?.()
    const first = await waitForDocument()
    await chrome.tabs.reload(tabId)
    const reloaded = await waitForDocument(first.documentId)
    let result: {
      error?: string
      checks?: {
        mounted: boolean
        restored: boolean
        recovery?: 'reload-required'
      }
    } = {}
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await options.scriptReady?.(reloaded, options.layer)
      result = await chrome.tabs.sendMessage(
        tabId,
        {
          channel: LAYER_CHANNEL,
          kind: 'command',
          command:
            options.layer.definition.mode === 'javascript'
              ? 'verify-reload'
              : 'verify',
          instanceId: reloaded.instanceId,
          routeEpoch: reloaded.routeEpoch,
          layer: options.layer,
        },
        { documentId: reloaded.documentId },
      )
      if (
        result?.checks?.mounted &&
        (result.checks.restored || result.checks.recovery === 'reload-required')
      )
        break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (result?.error) throw new Error(result.error)
    return {
      reloaded:
        result?.checks?.mounted === true &&
        (result?.checks?.restored === true ||
          result?.checks?.recovery === 'reload-required'),
      url: reloaded.url,
    }
  } finally {
    options.probes.delete(tabId)
    options.documents.delete(tabId)
    await chrome.tabs.remove(tabId).catch(() => undefined)
    await options.prepare?.().catch(() => undefined)
  }
}
