/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { PI_LIMITS } from '@browseros/shared/constants/limits'
import {
  MERMAID_PROTOCOL_VERSION,
  MERMAID_SANDBOX_PAGE,
} from './mermaid-protocol'
import {
  __resetMermaidBrokerForTests,
  renderMermaidInSandbox,
} from './mermaid-sandbox-broker'

type FakeMessage = {
  data: unknown
  source: unknown
}

type Listener = (event: FakeMessage) => void

describe('mermaid-sandbox-broker', () => {
  let listeners: Listener[]
  let appended: HTMLElement[]
  let chromeStub: { runtime: { getURL: (p: string) => string } }

  beforeEach(() => {
    __resetMermaidBrokerForTests()
    listeners = []
    appended = []
    chromeStub = {
      runtime: {
        getURL: (p: string) => `chrome-extension://test/${p}`,
      },
    }
    ;(globalThis as { chrome?: typeof chromeStub }).chrome = chromeStub

    const doc = {
      documentElement: {
        appendChild(node: HTMLElement) {
          appended.push(node)
          queueMicrotask(() => {
            const iframe = node as HTMLIFrameElement & {
              contentWindow: Window
            }
            for (const l of listeners) {
              l({
                data: {
                  type: 'pane-mermaid-ready',
                  version: MERMAID_PROTOCOL_VERSION,
                },
                source: iframe.contentWindow,
              })
            }
          })
          return node
        },
      },
      createElement(tag: string) {
        if (tag !== 'iframe') throw new Error(`unexpected tag ${tag}`)
        const contentWindow = {
          postMessage(data: unknown) {
            const req = data as {
              requestId: string
              source: string
              type: string
            }
            queueMicrotask(() => {
              for (const l of listeners) {
                l({
                  data: {
                    type: 'pane-mermaid-result',
                    version: MERMAID_PROTOCOL_VERSION,
                    requestId: req.requestId,
                    ok: true,
                    svg: `<svg data-src="${req.source.length}"></svg>`,
                  },
                  source: contentWindow,
                })
              }
            })
          },
        }
        const el = {
          setAttribute: mock(),
          style: { cssText: '' },
          src: '',
          contentWindow,
          remove: mock(() => {
            const idx = appended.indexOf(el as unknown as HTMLElement)
            if (idx >= 0) appended.splice(idx, 1)
          }),
          addEventListener() {},
        }
        return el as unknown as HTMLIFrameElement
      },
    }

    ;(globalThis as { document?: typeof doc }).document = doc
    ;(globalThis as { window?: Window }).window = {
      addEventListener(type: string, fn: EventListener) {
        if (type === 'message') listeners.push(fn as unknown as Listener)
      },
      removeEventListener(type: string, fn: EventListener) {
        if (type === 'message') {
          listeners = listeners.filter((l) => l !== (fn as unknown as Listener))
        }
      },
    } as unknown as Window
  })

  afterEach(() => {
    __resetMermaidBrokerForTests()
    delete (globalThis as { document?: unknown }).document
    delete (globalThis as { chrome?: unknown }).chrome
  })

  it('rejects oversize source before creating an iframe', async () => {
    const result = await renderMermaidInSandbox(
      'x'.repeat(PI_LIMITS.MAX_MERMAID_CHARS + 1),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/exceeds/)
    expect(appended).toHaveLength(0)
  })

  it('renders via sandbox and tears down the iframe', async () => {
    const result = await renderMermaidInSandbox('flowchart LR\nA-->B')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.svg).toContain('<svg')
    expect(chromeStub.runtime.getURL(MERMAID_SANDBOX_PAGE)).toContain(
      MERMAID_SANDBOX_PAGE,
    )
    expect(appended).toHaveLength(0)
  })

  it('serializes FIFO and ignores stale aborted requests', async () => {
    const c1 = new AbortController()
    const p1 = renderMermaidInSandbox('flowchart LR\nA-->B', {
      signal: c1.signal,
    })
    c1.abort()
    const p2 = renderMermaidInSandbox('flowchart LR\nC-->D')
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.error).toBe('cancelled')
    expect(r2.ok).toBe(true)
  })

  it('rejects forbidden init directives without iframe', async () => {
    const result = await renderMermaidInSandbox(
      '%%{init: {"maxTextSize": 999999}}%%\nflowchart LR\nA-->B',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/init directives/)
    expect(appended).toHaveLength(0)
  })

  it('retries once with a fresh iframe when the sandbox never finishes booting', async () => {
    // First iframe never sends its 'ready' handshake (simulates a cold
    // boot that got starved of CPU); the retry's iframe behaves normally.
    let appendCount = 0
    const doc = (globalThis as { document: typeof globalThis.document })
      .document as unknown as {
      documentElement: { appendChild: (node: HTMLElement) => HTMLElement }
    }
    doc.documentElement.appendChild = (node: HTMLElement) => {
      appendCount++
      appended.push(node)
      if (appendCount === 1) return node
      queueMicrotask(() => {
        const iframe = node as HTMLIFrameElement & { contentWindow: Window }
        for (const l of listeners) {
          l({
            data: {
              type: 'pane-mermaid-ready',
              version: MERMAID_PROTOCOL_VERSION,
            },
            source: iframe.contentWindow,
          })
        }
      })
      return node
    }

    const result = await renderMermaidInSandbox('flowchart LR\nA-->B', {
      timeoutMs: 20,
    })

    expect(result.ok).toBe(true)
    expect(appendCount).toBe(2)
  })

  it('does not retry a timeout that happens after boot (render itself hangs)', async () => {
    // The sandbox sends 'ready' and receives the request, but never
    // replies — a stuck render, not a boot problem. Retrying the same
    // source would very likely hang identically, so only one iframe
    // should ever be created.
    let createCount = 0
    const doc = (globalThis as { document: typeof globalThis.document })
      .document as unknown as {
      createElement: (tag: string) => HTMLIFrameElement
    }
    const originalCreateElement = doc.createElement.bind(doc)
    doc.createElement = (tag: string) => {
      createCount++
      const el = originalCreateElement(tag) as HTMLIFrameElement & {
        contentWindow: { postMessage: (data: unknown) => void }
      }
      el.contentWindow.postMessage = () => {
        // Swallow the render request — simulates mermaid.render() hanging.
      }
      return el
    }

    const result = await renderMermaidInSandbox('flowchart LR\nA-->B', {
      timeoutMs: 20,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('mermaid render timed out')
    expect(createCount).toBe(1)
  })
})
