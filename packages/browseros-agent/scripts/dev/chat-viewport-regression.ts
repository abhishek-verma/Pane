#!/usr/bin/env bun
/** Isolated Chromium regression: no installed Pane profile or chat is touched.
 * Run with: bun scripts/dev/chat-viewport-regression.ts
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const root = resolve(import.meta.dir, '../..')
const temporary = await mkdtemp(join(tmpdir(), 'pane-chat-viewport-'))
const build = await Bun.build({
  entrypoints: [resolve(root, 'apps/app/test-fixtures/chat-viewport.tsx')],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'isolated-chat-services',
      setup(builder) {
        builder.onResolve(
          { filter: /agent-server-url.hooks|browseros\/agent-fetch/ },
          ({ path }) => ({ path, namespace: 'fixture' }),
        )
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          loader: 'js',
          contents: path.includes('agent-fetch')
            ? 'export const agentFetch = (...args) => fetch(...args)'
            : 'export const useAgentServerUrl = () => ({ baseUrl: location.origin })',
        }))
      },
    },
  ],
})
assert(build.success, build.logs.join('\n'))
let requests = 0
let contentRequests = 0
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/app.js')
      return new Response(build.outputs[0], {
        headers: { 'Content-Type': 'text/javascript' },
      })
    if (path.includes('/message-content/')) {
      contentRequests++
      const second = new URL(request.url).searchParams.get('offset') === '8000'
      return Response.json({
        part: {
          type: 'text',
          text: second
            ? 'PAGE TWO: exact remaining content.'
            : 'PAGE ONE: exact first content.',
        },
        index: 5,
        totalParts: 6,
        previous: second ? { part: 5, offset: 0 } : null,
        next: second ? null : { part: 5, offset: 8000 },
      })
    }
    if (path.includes('/tool-details/')) {
      requests++
      if (requests === 1) return new Response('Try again', { status: 503 })
      return Response.json({
        input: { path: 'report.md', content: 'FULL INPUT' },
        output: `${'Complete tool output.\n'.repeat(5000)}END OF FULL RESULT`,
      })
    }
    return new Response(
      '<!doctype html><html><head><style>body{margin:0;font:14px/22px sans-serif}main{width:700px;margin:auto}#details{padding:20px}.agent-peek-scroll{max-height:300px;overflow:auto;white-space:pre-wrap}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
      { headers: { 'Content-Type': 'text/html' } },
    )
  },
})
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined
try {
  browser = await puppeteer.launch({
    executablePath:
      process.env.CHROME_PATH ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    userDataDir: temporary,
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1000, height: 800 })
  const errors: string[] = []
  page.on('pageerror', (error: Error) => errors.push(String(error)))
  await page.goto(`http://127.0.0.1:${server.port}`)
  await page.waitForSelector('[data-tool="0"]')
  assert.equal(requests, 0, 'details should not load until requested')
  const count = () =>
    page.$$eval('[data-viewport-block="mounted"]', (nodes) => nodes.length)
  assert((await count()) < 120, 'initial DOM must be bounded within one turn')
  await page.focus('[data-tool="0"] button')
  await page.$eval('#tool-500', (element) => element.scrollIntoView())
  await page.waitForSelector('[data-tool="500"]')
  assert(
    await page.$('[data-tool="0"]'),
    'focused controls must stay mounted offscreen',
  )
  await page.$eval('[data-tool="0"] button', (element) =>
    (element as HTMLElement).blur(),
  )
  await page.waitForFunction(() => !document.querySelector('[data-tool="0"]'))
  assert((await count()) < 120, 'middle of turn must still have bounded DOM')
  await page.$eval('#details', (element) => element.scrollIntoView())
  await page.waitForFunction(() =>
    document.body.innerText.includes('This is the complete final answer.'),
  )
  assert.equal(requests, 0)
  assert(await page.$('table'), 'Markdown tables must remain intact')
  assert(await page.$('pre'), 'Markdown code fences must remain intact')
  await page.click('#details button')
  await page.waitForFunction(() =>
    document.body.innerText.includes('Retry loading full details'),
  )
  await page.click('#details button')
  await page.waitForFunction(() =>
    document.body.innerText.includes('FULL INPUT'),
  )
  assert.equal(requests, 2, 'explicit retry should fetch full details')
  await page.$eval('#details .agent-peek-scroll', (element) => {
    element.scrollTop = element.scrollHeight
  })
  await page.waitForFunction(() =>
    document.body.innerText.includes('END OF FULL RESULT'),
  )
  await page.click('#details button')
  assert.equal(
    await page.$('#details .agent-peek-scroll'),
    null,
    'closing releases full details',
  )
  assert.equal(
    await page.$('[data-approve]'),
    null,
    'preview arguments must not be approvable',
  )
  await page.$eval('#approval', (element) => element.scrollIntoView())
  await page.click('#approval button')
  await page.waitForSelector('[data-approve]')
  await page.click('[data-approve]')
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(document.documentElement.dataset.approvedInput ?? '{}'),
    ),
    { path: 'report.md', content: 'FULL INPUT' },
  )
  assert.equal(contentRequests, 0, 'full turn pages must be on demand')
  await page.$eval('#turn-reader', (element) => element.scrollIntoView())
  await page.click('#turn-reader button')
  await page.waitForFunction(() =>
    document.querySelector('#turn-reader')?.textContent?.includes('PAGE ONE:'),
  )
  await page.evaluate(() => {
    const next = [
      ...document.querySelectorAll<HTMLButtonElement>('#turn-reader button'),
    ].find((button) => button.textContent === 'Next page')
    next?.click()
  })
  await page.waitForFunction(() =>
    document.querySelector('#turn-reader')?.textContent?.includes('PAGE TWO:'),
  )
  assert.equal(
    await page.$eval('#turn-reader', (element) =>
      element.textContent?.includes('PAGE ONE:'),
    ),
    false,
    'paging must release the prior page',
  )
  await page.click('#turn-reader button')
  assert.equal(
    await page.$('#turn-reader pre'),
    null,
    'close releases the loaded turn page',
  )
  await page.$eval('#tool-0', (element) => element.scrollIntoView())
  await page.waitForSelector('[data-tool="0"]')
  assert(
    (await count()) < 120,
    'scrolling back must remount only nearby content',
  )
  const unmountsBefore = await page.evaluate(() =>
    Number(document.documentElement.dataset.unmounts ?? 0),
  )
  await page.$eval('#tool-500', (element) => element.scrollIntoView())
  await page.waitForSelector('[data-tool="500"]')
  await page.waitForFunction(() => !document.querySelector('[data-tool="0"]'))
  assert((await count()) < 120, 'scrolling down again must keep DOM bounded')
  assert(
    (await page.evaluate(() =>
      Number(document.documentElement.dataset.unmounts ?? 0),
    )) > unmountsBefore,
    'revisited older rows must unmount again when scrolling down',
  )
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log(
    'PASS: 1,000 tool rows + long Markdown, code and table; bounded DOM, reversible scrolling, full answer, on-demand details/retry/close.',
  )
} finally {
  await browser?.close()
  server.stop(true)
  await rm(temporary, { recursive: true, force: true })
}
