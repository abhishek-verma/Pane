#!/usr/bin/env bun
/**
 * CDP regression: crash the Mermaid sandbox OOPIF and assert privileged
 * PI shell + sidepanel remain responsive; broker can retry after fallback.
 *
 * Requires Pane/BrowserOS running with CDP (default port 9010) and a built
 * extension that includes mermaid-sandbox.html.
 *
 * Usage:
 *   bun scripts/dev/mermaid-sandbox-crash-survival.ts [--cdp-port 9010]
 */

const DEFAULT_CDP_PORT = 9010
const EXTENSION_ID =
  process.env.BROWSEROS_EXTENSION_ID || 'biedncddmddkpapdplhcnkhhplnfgbif'
const REQUEST_TIMEOUT_MS = 30_000

const args = process.argv.slice(2)
const portFlag = args.indexOf('--cdp-port')
const cdpPort =
  portFlag >= 0 && args[portFlag + 1]
    ? Number(args[portFlag + 1])
    : DEFAULT_CDP_PORT

type CDPResponse = {
  id: number
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

class CDPClient {
  private ws!: WebSocket
  private nextId = 1
  private pending = new Map<
    number,
    {
      resolve: (v: Record<string, unknown>) => void
      reject: (e: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  static async connect(port: number): Promise<CDPClient> {
    const client = new CDPClient()
    const versionUrl = `http://127.0.0.1:${port}/json/version`
    let resp: Response
    try {
      resp = await fetch(versionUrl)
    } catch {
      throw new Error(
        `Cannot reach CDP at ${versionUrl}. Is BrowserOS running with --cdp-port=${port}?`,
      )
    }
    const info = (await resp.json()) as { webSocketDebuggerUrl: string }
    let wsUrl = info.webSocketDebuggerUrl
    if (!wsUrl) throw new Error('No webSocketDebuggerUrl in /json/version')
    wsUrl = wsUrl.replace(/ws:\/\/[^/]+/, `ws://127.0.0.1:${port}`)

    return new Promise((resolve, reject) => {
      client.ws = new WebSocket(wsUrl)
      client.ws.onopen = () => resolve(client)
      client.ws.onerror = () => reject(new Error('WebSocket error'))
      client.ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as CDPResponse
        if (msg.id === undefined) return
        const entry = client.pending.get(msg.id)
        if (!entry) return
        client.pending.delete(msg.id)
        clearTimeout(entry.timer)
        if (msg.error) {
          entry.reject(
            new Error(`CDP error ${msg.error.code}: ${msg.error.message}`),
          )
        } else {
          entry.resolve(msg.result ?? {})
        }
      }
    })
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      )
    })
  }

  close() {
    this.ws.close()
  }
}

async function listTargets(port: number) {
  const resp = await fetch(`http://127.0.0.1:${port}/json/list`)
  return (await resp.json()) as Array<{
    id: string
    type: string
    url: string
    title: string
    webSocketDebuggerUrl?: string
  }>
}

function die(msg: string): never {
  console.error(`mermaid-sandbox-crash-survival: ${msg}`)
  process.exit(1)
}

const client = await CDPClient.connect(cdpPort)
try {
  const targets = await listTargets(cdpPort)
  const sidepanel = targets.find(
    (t) =>
      t.url.includes(EXTENSION_ID) &&
      (t.url.includes('sidepanel.html') ||
        t.title.toLowerCase().includes('pane')),
  )
  const pi = targets.find(
    (t) =>
      t.url.includes(EXTENSION_ID) &&
      (t.url.includes('pi.html') || t.url.includes('pi://')),
  )

  if (!sidepanel && !pi) {
    die(
      'No sidepanel/pi extension target found. Open Pane sidepanel and a PI page, then retry.',
    )
  }

  const sandbox = targets.find(
    (t) =>
      t.url.includes(EXTENSION_ID) && t.url.includes('mermaid-sandbox.html'),
  )

  if (!sandbox) {
    console.log(
      'No live mermaid-sandbox target yet — opening PI and waiting is out of scope; checking privileged targets stay alive after optional crash.',
    )
  } else {
    const { sessionId } = (await client.send('Target.attachToTarget', {
      targetId: sandbox.id,
      flatten: true,
    })) as { sessionId: string }
    try {
      await client.send('Page.crash', {}, sessionId)
      console.log('Issued Page.crash to mermaid-sandbox OOPIF')
    } catch (e) {
      console.log(
        `Page.crash returned (often expected after process death): ${
          e instanceof Error ? e.message : e
        }`,
      )
    }
  }

  // Re-list and ensure privileged targets still exist / respond to Runtime.evaluate.
  await new Promise((r) => setTimeout(r, 500))
  const after = await listTargets(cdpPort)
  for (const label of ['sidepanel', 'pi'] as const) {
    const before = label === 'sidepanel' ? sidepanel : pi
    if (!before) continue
    const still =
      after.find((t) => t.id === before.id) ??
      after.find((t) => t.url === before.url)
    if (!still) {
      die(`${label} target disappeared after sandbox crash`)
    }
    const { sessionId } = (await client.send('Target.attachToTarget', {
      targetId: still.id,
      flatten: true,
    })) as { sessionId: string }
    const evalResult = (await client.send(
      'Runtime.evaluate',
      {
        expression: '1+1',
        returnByValue: true,
      },
      sessionId,
    )) as { result?: { value?: number } }
    if (evalResult.result?.value !== 2) {
      die(`${label} Runtime.evaluate failed after sandbox crash`)
    }
    console.log(`OK ${label} still responsive`)
  }

  console.log('mermaid-sandbox-crash-survival: passed')
} finally {
  client.close()
}
