/** Runs the production coordinator, SDK parser, outbox and UI bridge in an
 * isolated MV3 extension. Synthetic server only; never opens user profiles. */
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'

const app = resolve(import.meta.dir, '../../apps/app')
const dir = await mkdtemp(join(tmpdir(), 'pane-chat-repository-'))
type Conversation = {
  messages: any[]
  active: boolean
  turnId: string
  seq: number
  subscribers: Set<ReadableStreamDefaultController<Uint8Array>>
}
const conversations = new Map<string, Conversation>()
let streamOpens = 0,
  starts = 0
const encoder = new TextEncoder()
const frame = (value: unknown, seq = 0) =>
  encoder.encode(`id: ${seq}\ndata: ${JSON.stringify(value)}\n\n`)
const get = (id: string) => {
  let value = conversations.get(id)
  if (!value) {
    value = {
      messages: [],
      active: false,
      turnId: '',
      seq: 0,
      subscribers: new Set(),
    }
    conversations.set(id, value)
  }
  return value
}
const push = (value: Conversation) => {
  for (const subscriber of value.subscribers)
    try {
      subscriber.enqueue(
        frame({ type: 'snapshot', messages: value.messages }, ++value.seq),
      )
    } catch {
      value.subscribers.delete(subscriber)
    }
}
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname
    if (path === '/chat' && request.method === 'POST') {
      const body = (await request.json()) as any
      const value = get(body.conversationId)
      if (value.active) return new Response('already running', { status: 409 })
      starts++
      value.active = true
      value.turnId = crypto.randomUUID()
      const user = {
        id: body.clientMessageId || crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: body.message }],
      }
      const textPart = { type: 'text', text: '' }
      let assistant: any
      if (body.toolApprovalResponses?.length) {
        assistant = value.messages.at(-1)
        assistant.parts = assistant.parts.map((part: any) => {
          const response = body.toolApprovalResponses.find(
            (response: any) => response.approvalId === part.approval?.id,
          )
          return response
            ? {
                ...part,
                state: response.approved ? 'output-available' : 'output-denied',
                output: response.approved ? 'complete' : undefined,
                approval: { ...part.approval, approved: response.approved },
              }
            : part
        })
        assistant.parts.push(textPart)
      } else {
        assistant = {
          id: crypto.randomUUID(),
          role: 'assistant',
          parts: [textPart],
        }
        value.messages.push(user, assistant)
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const emit = (chunk: unknown) => {
              try {
                controller.enqueue(frame(chunk))
              } catch {}
            }
            emit({ type: 'start', messageId: assistant.id })
            emit({ type: 'text-start', id: 'text' })
            let count = 0
            const timer = setInterval(() => {
              textPart.text += 'reply '
              emit({ type: 'text-delta', id: 'text', delta: 'reply ' })
              push(value)
              if (++count === 12) {
                clearInterval(timer)
                value.active = false
                emit({ type: 'text-end', id: 'text' })
                emit({ type: 'finish', finishReason: 'stop' })
                for (const subscriber of value.subscribers) {
                  subscriber.enqueue(
                    frame({ type: 'done', status: 'done' }, ++value.seq),
                  )
                  subscriber.close()
                }
                value.subscribers.clear()
              }
            }, 80)
          },
        }),
        {
          headers: {
            'content-type': 'text/event-stream',
            'x-turn-id': value.turnId,
          },
        },
      )
    }
    const [, kind, id, operation] = path.split('/')
    if (kind !== 'chat') return new Response('missing', { status: 404 })
    const value = get(decodeURIComponent(id))
    if (operation === 'active')
      return Response.json({
        active: value.active
          ? {
              conversationId: id,
              turnId: value.turnId,
              status: 'running',
              lastSeq: value.seq,
              startedAt: 1,
              prompt: null,
              truncated: false,
            }
          : null,
      })
    if (operation === 'messages')
      return Response.json({ messages: value.messages, hasMore: false })
    if (operation === 'cancel') {
      value.active = false
      return Response.json({ cancelled: true })
    }
    if (operation === 'stream') {
      streamOpens++
      let current: ReadableStreamDefaultController<Uint8Array>
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            current = controller
            controller.enqueue(
              frame(
                { type: 'snapshot', messages: value.messages },
                ++value.seq,
              ),
            )
            if (value.active) value.subscribers.add(controller)
            else {
              controller.enqueue(
                frame({ type: 'done', status: 'done' }, ++value.seq),
              )
              controller.close()
            }
          },
          cancel() {
            value.subscribers.delete(current)
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      )
    }
    return new Response('missing', { status: 404 })
  },
})
let browser: Browser | undefined
const origin = `http://127.0.0.1:${server.port}`
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 15000
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`)
    await delay(50)
  }
}
try {
  await writeFile(
    join(dir, 'background.ts'),
    `import {startChatRepository} from ${JSON.stringify(join(app, 'lib/chat-repository/background.ts'))};globalThis.repository=startChatRepository();`,
  )
  await writeFile(
    join(dir, 'ui.ts'),
    `
import {chatRepositoryClient} from ${JSON.stringify(join(app, 'lib/chat-repository/client.ts'))};
import {composerKey,emptyComposer,updateComposer} from ${JSON.stringify(join(app, 'modules/chat/composer-store.ts'))};
globalThis.client=chatRepositoryClient;const id=new URL(location.href).searchParams.get('chat');
globalThis.id=id;globalThis.updates=0;
chatRepositoryClient.subscribe(id,state=>{globalThis.latest=state;globalThis.updates++;document.body.textContent=JSON.stringify(state)});
globalThis.run=text=>chatRepositoryClient.request('run',id,{request:{path:'/chat',body:{message:text,clientMessageId:crypto.randomUUID()}},messages:[...(globalThis.latest?.messages||[]),{id:crypto.randomUUID(),role:'user',parts:[{type:'text',text}]}]});
globalThis.enqueue=async texts=>{await updateComposer(composerKey(id),state=>({...state,paused:false,queue:[...state.queue,...texts.map(text=>({id:crypto.randomUUID(),state:'queued',message:{text},prepared:{path:'/chat',body:{providerId:'fixture',providerType:'openai',message:text}}}))]}));};
globalThis.ready=true;
`,
  )
  for (const entry of ['background', 'ui']) {
    const build = await Bun.build({
      entrypoints: [join(dir, `${entry}.ts`)],
      outdir: dir,
      naming: `${entry}.js`,
      target: 'browser',
      format: 'iife',
      plugins: [
        {
          name: 'isolated-backend',
          setup(build) {
            build.onResolve({ filter: /^@\// }, (args) => {
              const base = join(app, args.path.slice(2))
              const path = [
                base,
                `${base}.ts`,
                `${base}.tsx`,
                join(base, 'index.ts'),
              ].find(existsSync)
              return path ? { path } : undefined
            })
            build.onLoad(
              { filter: /lib\/browseros\/agent-fetch\.ts$/ },
              () => ({
                contents: 'export const agentFetch=(...args)=>fetch(...args)',
                loader: 'js',
              }),
            )
            build.onLoad({ filter: /lib\/browseros\/helpers\.ts$/ }, () => ({
              contents: `export const getAgentServerUrl=async()=>${JSON.stringify(origin)}`,
              loader: 'js',
            }))
            build.onLoad(
              { filter: /lib\/llm-providers\/storage\.ts$/ },
              () => ({
                contents: `export const providersStorage={getValue:async()=>[{id:'fixture',type:'openai',apiKey:'test'}]}`,
                loader: 'js',
              }),
            )
            build.onLoad(
              { filter: /lib\/trust\/trust-pins-storage\.ts$/ },
              () => ({
                contents: `export const trustPinsStorage={getValue:async()=>({})};export const conversationTrustStorage=trustPinsStorage;export const requireBrowserInputApprovalStorage={getValue:async()=>true}`,
                loader: 'js',
              }),
            )
          },
        },
      ],
    })
    if (!build.success) throw new Error(build.logs.map(String).join('\n'))
  }
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Pane chat repository isolated probe',
      version: '1.0',
      permissions: ['storage', 'alarms', 'tabs'],
      host_permissions: [`${origin}/*`],
      background: { service_worker: 'background.js' },
    }),
  )
  await writeFile(
    join(dir, 'ui.html'),
    '<!doctype html><body><script src="ui.js"></script>',
  )
  browser = await puppeteer.launch({
    executablePath:
      process.env.PANE_TEST_EXECUTABLE ||
      '/Applications/Pane.app/Contents/MacOS/Pane',
    headless: true,
    userDataDir: join(dir, 'profile'),
    env: { ...process.env, BROWSEROS_DIR: join(dir, 'server-data') },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${dir}`,
      `--load-extension=${dir}`,
      '--disable-browseros-server',
      '--disable-background-networking',
      '--disable-breakpad',
      '--disable-crash-reporter',
      '--no-first-run',
    ],
  })
  const target = await browser.waitForTarget(
    (target) =>
      target.type() === 'service_worker' &&
      target.url().endsWith('/background.js'),
  )
  let worker = (await target.worker())!
  const extension = new URL(target.url()).host
  const errors: string[] = []
  async function page(id: string, newWindow = false) {
    const url = `chrome-extension://${extension}/ui.html?chat=${id}&instance=${crypto.randomUUID()}`
    let page: Page
    if (newWindow) {
      const cdp = await browser!.target().createCDPSession()
      await cdp.send('Target.createTarget', { url, newWindow: true })
      page = (await (
        await browser!.waitForTarget((target) => target.url() === url)
      ).page())!
      await cdp.detach()
    } else {
      page = await browser!.newPage()
      await page.goto(url)
    }
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.bringToFront()
    await page.waitForFunction('globalThis.latest?.loaded', {
      polling: 100,
      timeout: 15000,
    })
    return page
  }
  const a = await page('shared', true),
    b = await page('shared', true)
  const extra: Page[] = []
  for (let i = 0; i < 6; i++) extra.push(await page('shared', true))
  const value = get('shared')
  value.active = true
  value.turnId = 'external'
  value.messages = [
    {
      id: 'assistant',
      role: 'assistant',
      parts: [{ type: 'text', text: 'external reply' }],
    },
  ]
  await worker.evaluate(() => (globalThis as any).repository.tick())
  await Promise.all(
    [a, b, ...extra].map((page) =>
      page.waitForFunction(
        'globalThis.latest.messages[0]?.parts[0]?.text === "external reply"',
        { polling: 100 },
      ),
    ),
  )
  if (value.subscribers.size !== 1)
    throw new Error(`Duplicate upstream streams: ${value.subscribers.size}`)
  const blank = await browser.newPage()
  await blank.goto('about:blank')
  await b.bringToFront()
  await blank.bringToFront()
  await b.bringToFront()
  value.messages[0].parts[0].text = 'after visibility'
  push(value)
  await b.waitForFunction(
    'globalThis.latest.messages[0]?.parts[0]?.text === "after visibility"',
    { polling: 100 },
  )
  value.active = false
  for (const subscriber of value.subscribers) {
    subscriber.enqueue(frame({ type: 'done', status: 'done' }, ++value.seq))
    subscriber.close()
  }
  value.subscribers.clear()
  await Promise.all([
    a.close(),
    b.close(),
    blank.close(),
    ...extra.map((page) => page.close()),
  ])
  console.log(
    'PASS: real MV3 ports, eight visible windows, one upstream stream, visibility catch-up',
  )
  const approvalChat = get('approvals')
  approvalChat.messages = [
    {
      id: 'assistant-approval',
      role: 'assistant',
      parts: ['approve-a', 'approve-b'].map((id) => ({
        type: 'dynamic-tool',
        toolName: 'write',
        toolCallId: id,
        state: 'approval-requested',
        input: { value: id },
        approval: { id },
      })),
    },
  ]
  const approvalA = await page('approvals', true),
    approvalB = await page('approvals', true)
  const beforeApprovals = starts
  await Promise.all(
    [approvalA, approvalB].map((view, index) =>
      view.evaluate(async (index) => {
        await (globalThis as any).client.request('approve', 'approvals', {
          decision: { id: index ? 'approve-b' : 'approve-a', approved: !index },
          request: {
            path: '/chat',
            body: { providerId: 'fixture', providerType: 'openai' },
          },
        })
      }, index),
    ),
  )
  await until(
    () => starts === beforeApprovals + 1 && !approvalChat.active,
    'one shared approval resume',
  )
  await Promise.all(
    [approvalA, approvalB].map((view) =>
      view.waitForFunction(
        'globalThis.latest.messages[0]?.parts[0]?.state === "output-available" && globalThis.latest.messages[0]?.parts[1]?.state === "output-denied"',
        { polling: 100 },
      ),
    ),
  )
  await Promise.all([approvalA.close(), approvalB.close()])
  console.log(
    'PASS: concurrent approvals from separate windows produce one resume and both views settle',
  )
  const source = await page('outbox')
  await source.evaluate(() => (globalThis as any).enqueue(['first', 'second']))
  await until(() => get('outbox').active, 'first queued turn accepted')
  await source.close()
  await until(
    () =>
      get('outbox').messages.filter((message) => message.role === 'user')
        .length === 2 && !get('outbox').active,
    'FIFO continues without views',
  )
  const reopened = await page('outbox')
  await reopened.waitForFunction('globalThis.latest.messages.length===4', {
    polling: 100,
  })
  console.log(
    'PASS: queue continues after last view closes; reopened view restores both completed turns',
  )
  const before = starts
  await reopened.evaluate(() => (globalThis as any).enqueue(['restart']))
  await until(() => get('outbox').active, 'restart turn accepted')
  await until(
    async () =>
      await worker.evaluate(async () => {
        const value = (
          await chrome.storage.local.get('chat-composer-v2:outbox')
        )['chat-composer-v2:outbox']
        return Boolean(value.queue[0]?.started)
      }),
    'durable receipt',
  )
  // Puppeteer must detach its debugger session too, otherwise Chromium leaves
  // a stopped target attached and it is not a realistic worker termination.
  await worker.close()
  await until(
    () => !get('outbox').active,
    'server turn finishes across worker restart',
  )
  await reopened.waitForFunction(
    'globalThis.latest.messages.length===6 && !globalThis.latest.busy',
    { polling: 100, timeout: 20000 },
  )
  if (starts !== before + 1)
    throw new Error('Worker restart duplicated the accepted POST')
  const nextTarget = await browser.waitForTarget(
    (item) => item.type() === 'service_worker' && item.url() === target.url(),
  )
  worker = (await nextTarget.worker())!
  await until(
    async () =>
      await worker.evaluate(
        async () =>
          !(await chrome.storage.local.get('chat-composer-v2:outbox'))[
            'chat-composer-v2:outbox'
          ].queue.length,
      ),
    'receipt settled after restart',
  )
  await reopened.close()
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    JSON.stringify({
      result: 'PASS',
      starts,
      streamOpens,
      checks: [
        'shared visible windows',
        'visibility acknowledgements',
        'view-independent FIFO',
        'rehydration',
        'worker restart without duplicate send',
      ],
    }),
  )
} finally {
  if (browser) await browser.close()
  server.stop(true)
  await rm(dir, { recursive: true, force: true })
}
