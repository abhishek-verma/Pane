import { documentHelloSchema, LAYER_CHANNEL } from '@/lib/layers/messages'
import { LayerScriptRequestError } from '@/lib/layers/script-errors'
import type { ScriptDocument } from './user-script-registry'

/** Recover the content runtime identity on demand after worker loss. The
 * userscript's instance id belongs to a different world and cannot substitute
 * for it. Never adopt a replacement document just because it has the same URL.
 */
export async function readActionDocument(
  target: Pick<ScriptDocument, 'tabId' | 'documentId' | 'url'>,
  browser: Pick<typeof chrome, 'tabs' | 'webNavigation'> = chrome,
) {
  const reply = documentHelloSchema.parse(
    await browser.tabs.sendMessage(
      target.tabId,
      { channel: LAYER_CHANNEL, kind: 'document-identity' },
      { documentId: target.documentId },
    ),
  )
  const [tab, frame] = await Promise.all([
    browser.tabs.get(target.tabId),
    browser.webNavigation.getFrame({ tabId: target.tabId, frameId: 0 }),
  ])
  if (
    tab.incognito ||
    frame?.documentId !== target.documentId ||
    frame.documentLifecycle !== 'active' ||
    frame.url !== target.url ||
    tab.url !== target.url ||
    reply.url !== target.url
  )
    throw new LayerScriptRequestError(
      'The script document changed. Retry on the current page.',
    )
  return {
    tabId: target.tabId,
    documentId: target.documentId,
    instanceId: reply.instanceId,
    routeEpoch: reply.routeEpoch,
    url: reply.url,
    title: reply.title,
    active: tab.active,
  }
}
