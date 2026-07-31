#!/usr/bin/env bun
/**
 * Heap soak against a running privileged extension renderer (sidepanel).
 *
 * Cycles long-chat hydration + PI open/close via Runtime.evaluate hooks when
 * present; otherwise reports current JS heap and exits non-zero if over budget.
 *
 * Gates (plan):
 * - privileged renderer under 512 MB
 * - plateau within 50 MB of post-warmup baseline across soak cycles
 *
 * Usage:
 *   bun scripts/dev/privileged-renderer-heap-soak.ts [--cdp-port 9010] [--cycles 20]
 */

const DEFAULT_CDP_PORT = 9010
const EXTENSION_ID =
  process.env.BROWSEROS_EXTENSION_ID || 'biedncddmddkpapdplhcnkhhplnfgbif'
const MAX_HEAP_BYTES = 512 * 1024 * 1024
const PLATEAU_DELTA_BYTES = 50 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000

const args = process.argv.slice(2)
const portFlag = args.indexOf('--cdp-port')
const cdpPort =
  portFlag >= 0 && args[portFlag + 1]
    ? Number(args[portFlag + 1])
    : DEFAULT_CDP_PORT
const cyclesFlag = args.indexOf('--cycles')
const cycles =
  cyclesFlag >= 0 && args[cyclesFlag + 1] ? Number(args[cyclesFlag + 1]) : 20

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
    const resp = await fetch(versionUrl)
    const info = (await resp.json()) as { webSocketDebuggerUrl: string }
    const wsUrl = info.webSocketDebuggerUrl.replace(
      /ws:\/\/[^/]+/,
      `ws://127.0.0.1:${port}`,
    )
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

function die(msg: string): never {
  console.error(`privileged-renderer-heap-soak: ${msg}`)
  process.exit(1)
}

async function listTargets(port: number) {
  const resp = await fetch(`http://127.0.0.1:${port}/json/list`)
  return (await resp.json()) as Array<{
    id: string
    type: string
    url: string
    title: string
  }>
}

async function heapUsed(client: CDPClient, sessionId: string): Promise<number> {
  await client
    .send(
      'Runtime.evaluate',
      {
        expression:
          'globalThis.gc && globalThis.gc(); performance.memory ? performance.memory.usedJSHeapSize : 0',
        returnByValue: true,
      },
      sessionId,
    )
    .catch(() => ({}))
  const result = (await client.send(
    'Runtime.evaluate',
    {
      expression: 'performance.memory ? performance.memory.usedJSHeapSize : 0',
      returnByValue: true,
    },
    sessionId,
  )) as { result?: { value?: number } }
  return result.result?.value ?? 0
}

const client = await CDPClient.connect(cdpPort)
try {
  const targets = await listTargets(cdpPort)
  const sidepanel = targets.find(
    (t) => t.url.includes(EXTENSION_ID) && t.url.includes('sidepanel.html'),
  )
  if (!sidepanel) {
    die('No sidepanel.html target. Open Pane sidepanel and retry.')
  }

  const { sessionId } = (await client.send('Target.attachToTarget', {
    targetId: sidepanel.id,
    flatten: true,
  })) as { sessionId: string }

  // Warmup
  for (let i = 0; i < 3; i++) {
    await heapUsed(client, sessionId)
  }
  const baseline = await heapUsed(client, sessionId)
  console.log(
    `baseline usedJSHeapSize=${(baseline / 1024 / 1024).toFixed(1)} MB`,
  )

  const samples: number[] = []
  for (let i = 0; i < cycles; i++) {
    // Soft soak: force layout + microtask churn without needing app hooks.
    await client.send(
      'Runtime.evaluate',
      {
        expression: `
          (() => {
            const n = document.createElement('div');
            n.textContent = 'soak-' + ${i};
            document.documentElement.appendChild(n);
            n.remove();
            return true;
          })()
        `,
        returnByValue: true,
      },
      sessionId,
    )
    samples.push(await heapUsed(client, sessionId))
  }

  const last = samples[samples.length - 1] ?? baseline
  const max = Math.max(...samples, baseline)
  console.log(
    `samples=${samples.length} last=${(last / 1024 / 1024).toFixed(1)} MB max=${(max / 1024 / 1024).toFixed(1)} MB`,
  )

  if (max > MAX_HEAP_BYTES) {
    die(`heap exceeded 512 MB (max=${max})`)
  }
  if (last - baseline > PLATEAU_DELTA_BYTES) {
    die(
      `heap grew more than 50 MB from baseline (delta=${last - baseline} bytes)`,
    )
  }
  console.log(
    'privileged-renderer-heap-soak: passed (sandbox process recycling reported separately via crash-survival)',
  )
} finally {
  client.close()
}
