/** Real mention editor + tab picker with isolated browser/tab data. */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const currentTab = {
  id: 1,
  title: 'Current Checkout',
  url: 'https://example.com/checkout',
}
const temporary = await mkdtemp(join(tmpdir(), 'pane-composer-tabs-'))
const build = await Bun.build({
  entrypoints: [
    resolve(
      import.meta.dir,
      '../../apps/app/test-fixtures/composer-tab-refresh.tsx',
    ),
  ],
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'fixture-tabs',
      setup(builder) {
        builder.onResolve({ filter: /available-tabs\.hooks$/ }, ({ path }) => ({
          path,
          namespace: 'fixture',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          loader: 'js',
          contents: `const tabs=[${JSON.stringify(currentTab)}]; export const useAvailableTabs=()=>({tabs,allTabs:tabs,isLoading:false})`,
        }))
      },
    },
  ],
})
assert(build.success, build.logs.join('\n'))
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    if (new URL(request.url).pathname === '/app.js')
      return new Response(build.outputs[0], {
        headers: { 'Content-Type': 'text/javascript' },
      })
    return new Response(
      '<!doctype html><html><head><style>[contenteditable]{white-space:pre-wrap}body{padding:100px 20px}svg{width:16px;height:16px}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
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
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.evaluateOnNewDocument((tab) => {
    Object.assign(globalThis.chrome, { tabs: { get: async () => tab } })
  }, currentTab)
  await page.goto(`http://127.0.0.1:${server.port}`)
  await page.waitForSelector('[role="textbox"]')
  await page.focus('[role="textbox"]')
  await page.$eval('[role="textbox"]', (element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.keyboard.type('@')
  await page
    .waitForSelector('[data-tab-item]', { timeout: 5000 })
    .catch(async (error) => {
      console.error(
        errors,
        await page.$eval('body', (element) => element.innerHTML),
      )
      throw error
    })
  // An already attached tab must remain available to explicitly re-mention.
  await page.click('[data-tab-item]')
  await page.waitForFunction(() =>
    document
      .querySelector('#draft-state')
      ?.textContent?.includes('Current Checkout'),
  )
  const draft = JSON.parse(
    await page.$eval('#draft-state', (element) => element.textContent!),
  )
  assert.equal(draft.tabs.length, 1)
  assert.deepEqual(draft.tabs[0], currentTab)
  assert(draft.text.includes('@[Current Checkout](tab:1)'))
  await page.click('[aria-label="Send message"]')
  await page.waitForFunction(() =>
    Boolean(document.documentElement.dataset.sent),
  )
  const sent = JSON.parse(
    await page.evaluate(() => document.documentElement.dataset.sent!),
  )
  assert.deepEqual(sent.tabs, [currentTab])
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log(
    'PASS: already attached tab can be reselected; mention and snapshot agree; completed chat sends current page context.',
  )
} finally {
  await browser?.close()
  server.stop(true)
  await rm(temporary, { recursive: true, force: true })
}
