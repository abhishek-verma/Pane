import { describe, expect, it } from 'bun:test'
import { readActionDocument } from '../../entrypoints/background/layers/action-document'
import { LAYER_CHANNEL } from './messages'
import {
  LayerScriptRequestError,
  scriptActionFailureMessage,
  scriptRequestErrorMessage,
} from './script-errors'

const target = {
  tabId: 7,
  documentId: 'native-document',
  url: 'https://example.com/article',
}
function fixture() {
  const reply = {
    channel: LAYER_CHANNEL,
    kind: 'hello',
    instanceId: crypto.randomUUID(),
    routeEpoch: 3,
    url: target.url,
    title: 'Article',
  }
  const frame = {
    documentId: target.documentId,
    documentLifecycle: 'active',
    url: target.url,
  }
  const tab = { url: target.url, active: true, incognito: false }
  const browser = {
    tabs: {
      sendMessage: async (
        tabId: number,
        message: unknown,
        options: unknown,
      ) => {
        expect(tabId).toBe(target.tabId)
        expect(message).toEqual({
          channel: LAYER_CHANNEL,
          kind: 'document-identity',
        })
        expect(options).toEqual({ documentId: target.documentId })
        return reply
      },
      get: async () => tab,
    },
    webNavigation: { getFrame: async () => frame },
  } as unknown as Parameters<typeof readActionDocument>[1]
  return { browser, reply, frame, tab }
}
describe('script action document recovery', () => {
  it('recovers the content identity without a cached worker registration', async () => {
    const f = fixture()
    expect(await readActionDocument(target, f.browser)).toEqual({
      ...target,
      instanceId: f.reply.instanceId,
      routeEpoch: 3,
      title: 'Article',
      active: true,
    })
  })
  it('rejects a same-URL replacement, inactive page, changed route or incognito tab', async () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => {
        f.frame.documentId = 'replacement'
      },
      (f: ReturnType<typeof fixture>) => {
        f.frame.documentLifecycle = 'cached'
      },
      (f: ReturnType<typeof fixture>) => {
        f.frame.url += '/changed'
      },
      (f: ReturnType<typeof fixture>) => {
        f.reply.url += '/changed'
      },
      (f: ReturnType<typeof fixture>) => {
        f.tab.incognito = true
      },
    ]) {
      const f = fixture()
      change(f)
      await expect(readActionDocument(target, f.browser)).rejects.toThrow(
        'document changed',
      )
    }
  })
  it('exposes only explicit host diagnostics, never raw provider errors', () => {
    expect(scriptActionFailureMessage('PROVIDER_AUTH_REQUIRED')).toContain(
      'Sign in',
    )
    expect(scriptActionFailureMessage('PROVIDER_RATE_LIMITED')).toContain(
      'usage limit',
    )
    expect(scriptActionFailureMessage('PROVIDER_ACCESS_DENIED')).toContain(
      'denied',
    )
    expect(scriptActionFailureMessage('DEADLINE_EXCEEDED')).toContain(
      'time limit',
    )
    expect(scriptActionFailureMessage('Bearer secret')).not.toContain('secret')
    expect(
      scriptRequestErrorMessage(new LayerScriptRequestError('Layer disabled.')),
    ).toBe('Layer disabled.')
    const error = scriptRequestErrorMessage(
      new Error('provider failed: Bearer secret'),
    )
    expect(error).toContain('Recent activity')
    expect(error).not.toContain('secret')
    expect(error).not.toContain('authorized')
  })
})
