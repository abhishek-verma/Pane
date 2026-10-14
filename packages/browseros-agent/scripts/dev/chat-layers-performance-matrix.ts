/** Isolated factorial benchmark; see artifact scope for deliberate limitations. */
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'

const app = resolve(import.meta.dir, '../../apps/app')
const dir = await mkdtemp(join(tmpdir(), 'pane-permutation-'))
const artifact =
  process.env.PANE_PERF_OUTPUT || '/private/tmp/pane-performance-matrix.json'
const build = await Bun.build({
  entrypoints: [join(import.meta.dir, 'fixtures/chat-layers-performance.tsx')],
  outdir: dir,
  naming: 'fixture.js',
  target: 'browser',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'fixture',
      setup(b) {
        b.onResolve({ filter: /^@\// }, (args) => {
          const base = join(app, args.path.slice(2))
          const path = [
            base,
            `${base}.ts`,
            `${base}.tsx`,
            join(base, 'index.ts'),
          ].find(existsSync)
          return path ? { path } : undefined
        })
        b.onResolve(
          { filter: /^react(?:\/.*)?$|^react-dom(?:\/.*)?$/ },
          (args) => ({ path: Bun.resolveSync(args.path, app) }),
        )
        b.onLoad({ filter: /lib\/browseros\/agent-fetch\.ts$/ }, () => ({
          contents: 'export const agentFetch = (...args) => fetch(...args)',
          loader: 'js',
        }))
        b.onLoad({ filter: /lib\/browseros\/helpers\.ts$/ }, () => ({
          contents:
            'export const getAgentServerUrl = async () => location.origin',
          loader: 'js',
        }))
      },
    },
  ],
})
if (!build.success) throw new Error(build.logs.map(String).join('\n'))
const history = Array.from({ length: 30 }, (_, i) => ({
  id: `m${i}`,
  role: i % 2 ? 'assistant' : 'user',
  parts: [
    {
      type: 'text',
      text:
        `## Reply ${i}\n\n` +
        'A paragraph with **emphasis** and a [reference](https://example.invalid).\n\n'.repeat(
          45,
        ),
    },
  ],
}))
let phase = 'idle',
  tick = 0,
  bytes = 0,
  openedStreams = 0
const requests: Record<string, number> = {}
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
const encoder = new TextEncoder()
const transcript = () => [
  ...history,
  {
    id: 'live',
    role: 'assistant',
    parts: [
      {
        type: 'text',
        text:
          '## Current reply\n\n' +
          'Streaming text with **formatting**. '.repeat(tick + 1),
      },
    ],
  },
]
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/fixture.js')
      return new Response(Bun.file(join(dir, 'fixture.js')))
    if (url.pathname.startsWith('/chat/')) {
      const kind = url.pathname.split('/').at(-1)!
      requests[kind] = (requests[kind] ?? 0) + 1
      if (kind === 'active')
        return Response.json({
          active:
            phase === 'streaming'
              ? {
                  turnId: 'turn',
                  conversationId: url.pathname.split('/')[2],
                  status: 'running',
                  lastSeq: tick,
                  startedAt: 1,
                  prompt: null,
                  truncated: false,
                }
              : null,
        })
      if (kind === 'messages') {
        const body = JSON.stringify({ messages: transcript(), hasMore: false })
        bytes += body.length
        return new Response(body, {
          headers: { 'content-type': 'application/json' },
        })
      }
      if (kind === 'stream') {
        let writer: ReadableStreamDefaultController<Uint8Array>
        openedStreams++
        return new Response(
          new ReadableStream({
            start(value) {
              writer = value
              streams.add(writer)
              const frame = `id: ${tick}\ndata: ${JSON.stringify({ type: 'snapshot', messages: transcript() })}\n\n`
              bytes += frame.length
              writer.enqueue(encoder.encode(frame))
            },
            cancel() {
              streams.delete(writer)
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        )
      }
    }
    return new Response(
      '<!doctype html><style>body{font:14px system-ui}input{position:fixed;top:0;left:0;width:95%;z-index:99}main{margin-top:40px}article{max-width:650px}</style><main></main><script>globalThis.chrome={runtime:{getURL:p=>location.origin+"/"+p},storage:{}};</script><script src="/fixture.js"></script>',
      { headers: { 'content-type': 'text/html' } },
    )
  },
})
const tickTimer = setInterval(
  () => {
    if (phase !== 'streaming') return
    tick++
    const frame = `id: ${tick}\ndata: ${JSON.stringify({ type: 'snapshot', messages: transcript() })}\n\n`
    for (const writer of streams) {
      try {
        writer.enqueue(encoder.encode(frame))
        bytes += frame.length
      } catch {
        streams.delete(writer)
      }
    }
  },
  Number(process.env.PANE_PERF_SNAPSHOT_MS || 500),
)
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined
const results: any[] = []
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function metrics(page: Page) {
  const session = await page.createCDPSession()
  await session.send('Performance.enable')
  return {
    session,
    read: async () =>
      new Map(
        (await session.send('Performance.getMetrics')).metrics.map((x) => [
          x.name,
          x.value,
        ]),
      ),
  }
}
try {
  browser = await puppeteer.launch({
    executablePath:
      process.env.PANE_TEST_EXECUTABLE ||
      '/Applications/Pane.app/Contents/MacOS/Pane',
    headless: true,
    userDataDir: join(dir, 'profile'),
    env: { ...process.env, BROWSEROS_DIR: join(dir, 'server-data') },
    args: [
      '--disable-browseros-server',
      '--disable-background-networking',
      '--disable-breakpad',
      '--disable-crash-reporter',
      '--no-first-run',
    ],
  })
  const combinations = [
    { views: 1, topology: 'single' },
    { views: 4, topology: 'same' },
    { views: 4, topology: 'different' },
    { views: 8, topology: 'same' },
    { views: 8, topology: 'different' },
  ]
  for (const combo of process.env.PANE_PERF_VERIFY_ONLY ? [] : combinations) {
    for (const layers of ['off', 'nonmatching', 'managed', 'heavy']) {
      if (
        process.env.PANE_PERF_QUICK &&
        (combo.views !== 1 || !['off', 'heavy'].includes(layers))
      )
        continue
      phase = 'idle'
      tick = 0
      const webPages = await Promise.all(
        Array.from({ length: 4 }, () => browser!.newPage()),
      )
      const chats = await Promise.all(
        Array.from({ length: combo.views }, () => browser!.newPage()),
      )
      const pages = [...webPages, ...chats],
        errors: string[] = []
      pages.forEach((p) => {
        p.on('pageerror', (error) => errors.push(String(error)))
      })
      await Promise.all(
        webPages.map((p) =>
          p.goto(`http://127.0.0.1:${server.port}/?kind=web&layers=${layers}`),
        ),
      )
      await Promise.all(
        chats.map((p, i) =>
          p.goto(
            `http://127.0.0.1:${server.port}/?kind=chat&chat=${combo.topology === 'different' ? i : 0}`,
          ),
        ),
      )
      await Promise.all(
        pages.map((p) =>
          p.waitForFunction('globalThis.ready===true', { timeout: 15000 }),
        ),
      )
      await chats[0].bringToFront()
      await chats[0].waitForSelector('#composer')
      await delay(500)
      const profilers = await Promise.all(pages.map(metrics))
      for (const state of ['idle', 'streaming', 'settled']) {
        if (state === 'streaming') phase = 'streaming'
        if (state === 'settled') {
          phase = 'settled'
          for (const writer of streams) {
            writer.enqueue(
              encoder.encode(
                `id: ${tick + 1}\ndata: {"type":"done","status":"done"}\n\n`,
              ),
            )
            writer.close()
          }
          streams.clear()
        }
        const before = await Promise.all(profilers.map((p) => p.read())),
          oldBytes = bytes,
          oldRequests = { ...requests },
          oldStreams = openedStreams
        await Promise.all(
          pages.map((p) =>
            p.evaluate(() => {
              const s = (globalThis as any).stats
              for (const k of [
                'applies',
                'projectionMs',
                'reconciles',
                'longTasks',
                'longTaskMs',
              ])
                s[k] = 0
              s.inputPaintMs = []
            }),
          ),
        )
        const start = performance.now()
        await chats[0].click('#composer')
        await chats[0].keyboard.type('a realistic typing probe ', { delay: 15 })
        await delay(state === 'streaming' ? 4500 : 2200)
        const switchStart = performance.now()
        await chats.at(-1)!.bringToFront()
        await chats.at(-1)!.evaluate(() => document.visibilityState)
        const switchMs = performance.now() - switchStart
        await chats[0].bringToFront()
        const after = await Promise.all(profilers.map((p) => p.read()))
        const stats = await Promise.all(
          pages.map((p) =>
            p.evaluate(() => ({
              ...(globalThis as any).stats,
              hidden: document.hidden,
            })),
          ),
        )
        const delta = (name: string) =>
          after.reduce(
            (total, m, i) =>
              total + (m.get(name) ?? 0) - (before[i].get(name) ?? 0),
            0,
          )
        const input = stats.flatMap((s) => s.inputPaintMs).sort((a, b) => a - b)
        const row = {
          ...combo,
          layers,
          state,
          durationMs: Math.round(performance.now() - start),
          taskMs: Math.round(delta('TaskDuration') * 1000),
          scriptMs: Math.round(delta('ScriptDuration') * 1000),
          layoutMs: Math.round(delta('LayoutDuration') * 1000),
          heapMB: Math.round(
            after.reduce((n, m) => n + (m.get('JSHeapUsedSize') ?? 0), 0) / 1e6,
          ),
          inputP95Ms: input[Math.floor(input.length * 0.95)] ?? null,
          switchMs: Math.round(switchMs),
          transferredBytes: bytes - oldBytes,
          requests: Object.fromEntries(
            Object.keys(requests).map((k) => [
              k,
              requests[k] - (oldRequests[k] ?? 0),
            ]),
          ),
          newStreams: openedStreams - oldStreams,
          activeStreams: streams.size,
          applies: stats.reduce((n, s) => n + s.applies, 0),
          reconciles: stats.reduce((n, s) => n + s.reconciles, 0),
          longTasks: stats.reduce((n, s) => n + s.longTasks, 0),
          hiddenChats: stats.slice(4).filter((s) => s.hidden).length,
          errors: [...errors],
        }
        results.push(row)
        console.log(JSON.stringify(row))
        await writeFile(
          artifact,
          JSON.stringify(
            {
              scope:
                'Synthetic pages; production managed Layers, chat controller/SSE/projection/markdown; production visibility scheduler with mirrored history callback; not full extension or arbitrary JavaScript Layers.',
              webTabs: 4,
              domNodesPerWebTab: 10000,
              snapshotIntervalMs: Number(
                process.env.PANE_PERF_SNAPSHOT_MS || 500,
              ),
              results,
            },
            null,
            2,
          ),
        )
      }
      await Promise.all(
        pages.map((p) =>
          p.evaluate(() => {
            ;(globalThis as any).dispose()
          }),
        ),
      )
      await Promise.all(profilers.map((p) => p.session.detach()))
      await Promise.all(pages.map((p) => p.close()))
      await delay(100)
      if (streams.size)
        throw new Error(`Leaked ${streams.size} stream subscribers`)
      if (errors.length) throw new Error(errors.join('\n'))
    }
  }
  if (process.env.PANE_PERF_VERIFY_ONLY) {
    phase = 'streaming'
    const first = await browser.newPage()
    const second = await browser.newPage()
    const url = `http://127.0.0.1:${server.port}/?kind=chat&chat=verification`
    await first.goto(url)
    await second.goto(url)
    await second.bringToFront()
    await second.waitForFunction('globalThis.stats.applies > 0')
    await delay(100)
    if (streams.size !== 1)
      throw new Error(`Expected one visible follower, got ${streams.size}`)
    const appliedBefore = await first.evaluate(
      () => (globalThis as any).stats.applies,
    )
    await delay(1100)
    if (
      (await first.evaluate(() => (globalThis as any).stats.applies)) !==
      appliedBefore
    )
      throw new Error('Hidden follower applied streamed snapshots')
    await first.bringToFront()
    await first.waitForFunction('globalThis.stats.applies > 0')
    await delay(100)
    if (streams.size !== 1)
      throw new Error('Switching views retained duplicate subscriptions')
    // Finish while second is hidden, then reopen it within the 10s history window.
    phase = 'settled'
    tick = 50
    for (const writer of streams) {
      writer.enqueue(
        encoder.encode(`id: 999\ndata: {"type":"done","status":"done"}\n\n`),
      )
      writer.close()
    }
    streams.clear()
    const historyBefore = requests.messages ?? 0
    await second.bringToFront()
    await second.waitForFunction(
      () =>
        (globalThis as any).lastMessages
          ?.at(-1)
          ?.parts[0]?.text.includes('formatting') &&
        (globalThis as any).lastMessages.at(-1).parts[0].text.length > 1500,
    )
    if ((requests.messages ?? 0) <= historyBefore)
      throw new Error('Reopened completed chat did not fetch fresh history')
    if (requests.cancel)
      throw new Error('Hiding a view cancelled a server turn')
    await first.close()
    await second.close()
    console.log('PASS: same-tab hide/show and completed-history recovery')
    phase = 'streaming'
    const cdp = await browser.target().createCDPSession()
    const windowPages: Page[] = []
    for (const name of ['one', 'two']) {
      const windowUrl = `${url}&window=${name}`
      await cdp.send('Target.createTarget', { url: windowUrl, newWindow: true })
      const target = await browser.waitForTarget(
        (target) => target.url() === windowUrl,
      )
      const page = await target.page()
      if (!page) throw new Error('Failed to open a chat window')
      windowPages.push(page)
      await page.bringToFront()
      await page.waitForFunction('globalThis.ready', {
        polling: 100,
        timeout: 5000,
      })
      await page.waitForFunction('globalThis.stats.applies > 0', {
        polling: 100,
        timeout: 5000,
      })
    }
    await delay(100)
    const visibility = await Promise.all(
      windowPages.map((page) => page.evaluate(() => document.hidden)),
    )
    if (visibility.some(Boolean))
      throw new Error('Two-window fixture must keep both documents visible')
    if (streams.size !== 2)
      throw new Error('Visible windows must both retain live subscriptions')
    tick = 80
    await Promise.all(
      windowPages.map((page) =>
        page.waitForFunction(
          () =>
            (globalThis as any).lastMessages?.at(-1)?.parts[0]?.text.length >
            2700,
          { polling: 100, timeout: 5000 },
        ),
      ),
    )
    await Promise.all(windowPages.map((page) => page.close()))
    await cdp.detach()
    console.log(
      'PASS: two visible windows of the same chat both receive current snapshots',
    )
    console.log(
      'PASS: hidden stream suspension, switch-back snapshot catch-up, immediate completed-history restore, no server cancellation',
    )
  }
} finally {
  clearInterval(tickTimer)
  server.stop(true)
  if (browser) await browser.close()
  await rm(dir, { recursive: true, force: true })
}
if (!process.env.PANE_PERF_VERIFY_ONLY) console.log(`Results: ${artifact}`)
