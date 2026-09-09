/** Disposable-profile browser probe. Never connects to the user's browser. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer, { type Browser } from 'puppeteer-core'

const root = resolve(import.meta.dir, '../..')
const dir = await mkdtemp(join(tmpdir(), 'pane-layers-probe-'))
let browser: Browser | undefined
let fixture: ReturnType<typeof Bun.serve> | undefined
try {
  fixture = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new Response(
        '<!doctype html><html><body><article><h1>Article</h1><p>Readable content</p></article><aside id="recommendations">Recommendations</aside><form><input id="draft" value="unsaved draft"></form></body></html>',
        {
          headers: {
            'Content-Type': 'text/html',
            ...(new URL(request.url).pathname.endsWith('/csp')
              ? {
                  'Content-Security-Policy':
                    "default-src 'self'; script-src 'none'; style-src 'none'",
                }
              : {}),
          },
        },
      ),
  })
  const origin = `http://127.0.0.1:${fixture.port}`
  const source = `
import { ManagedLayerRuntime } from ${JSON.stringify(join(root, 'apps/app/lib/layers/runtime.ts'))};
import { LayerTranslationSnapshot } from ${JSON.stringify(join(root, 'apps/app/lib/layers/translation.ts'))};
let snapshot;
const runtime = new ManagedLayerRuntime(document, {status: statuses => chrome.runtime.sendMessage({kind:'status',statuses})});
chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
  if(message.kind==='update'){runtime.update(message.layers, message.url || location.href); reply({ok:true});}
  if(message.kind==='capture'){snapshot?.dispose();snapshot=new LayerTranslationSnapshot(document.querySelector('article'),message.language || 'en');reply(snapshot.input);}
  if(message.kind==='render'){reply({status:snapshot.render(message.data)});}
});
chrome.storage.local.get('layers').then(({layers=[]})=>runtime.update(layers));
`
  await writeFile(join(dir, 'entry.ts'), source)
  const build = await Bun.build({
    entrypoints: [join(dir, 'entry.ts')],
    outdir: dir,
    naming: 'content.js',
    target: 'browser',
    format: 'iife',
  })
  if (!build.success) throw new Error(build.logs.map(String).join('\n'))
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Pane Layers disposable probe',
      version: '1.0',
      permissions: ['storage', 'scripting', 'tabs', 'userScripts'],
      host_permissions: [`${origin}/*`],
      background: { service_worker: 'background.js' },
      content_scripts: [
        {
          matches: [`${origin}/*`],
          js: ['content.js'],
          run_at: 'document_idle',
        },
      ],
    }),
  )
  await writeFile(
    join(dir, 'background.js'),
    'globalThis.latest=[];chrome.runtime.onMessage.addListener(m=>{if(m.kind==="status")globalThis.latest=m.statuses});',
  )

  browser = await puppeteer.launch({
    executablePath:
      process.env.PANE_TEST_EXECUTABLE ||
      '/Applications/Pane.app/Contents/MacOS/Pane',
    headless: true,
    userDataDir: join(dir, 'profile'),
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${dir}`,
      `--load-extension=${dir}`,
      '--disable-browseros-server',
      '--disable-background-networking',
      '--no-first-run',
    ],
  })

  const target = await browser.waitForTarget(
    (target) =>
      target.type() === 'service_worker' &&
      target.url().endsWith('/background.js'),
    { timeout: 20_000 },
  )
  const worker = await target.worker()
  if (!worker) throw new Error('Probe extension worker unavailable')
  const support = await worker.evaluate(async () => {
    try {
      const scripts = await chrome.userScripts.getScripts()
      return {
        available: true,
        registrations: scripts.length,
        messaging: 'onUserScriptMessage' in chrome.runtime,
      }
    } catch (error) {
      return { available: false, reason: String(error) }
    }
  })
  const page = await browser.newPage()
  await page.goto(`${origin}/articles/one`)
  await page.waitForFunction(() =>
    document.querySelector('style[data-pane-layer-owned]'),
  )
  const layer = {
    id: 'quiet',
    version: 'a'.repeat(64),
    definition: {
      protocol: 'pane.layers.v1',
      name: 'Quiet',
      intent: 'Hide recommendations',
      mode: 'managed',
      scope: { origin, paths: ['/articles/*'], excludePaths: [], query: {} },
      actions: [],
      operations: [
        {
          id: 'hide',
          kind: 'collapse',
          label: 'Recommendations',
          anchor: { selector: '#recommendations', maxMatches: 1 },
        },
      ],
    },
  }
  const update = async (layers: unknown[]) =>
    worker.evaluate(
      async (layers, origin) => {
        await chrome.storage.local.set({ layers })
        const tabs = await chrome.tabs.query({ url: `${origin}/*` })
        for (const tab of tabs)
          if (tab.id !== undefined)
            await chrome.tabs.sendMessage(tab.id, { kind: 'update', layers })
      },
      layers,
      origin,
    )
  const hidden = () =>
    page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector('#recommendations') ?? document.body,
        ).display === 'none',
    )
  const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message)
  }
  await update([layer])
  assert(await hidden(), 'Mount did not hide recommendations')
  await page.evaluate(() =>
    document.querySelector('span[data-pane-layer-owned]')?.remove(),
  )
  await page.waitForFunction(() =>
    document.querySelector('span[data-pane-layer-owned]'),
  )
  assert(await hidden(), 'Site rerender recovery lost the effect')
  await page.evaluate(() =>
    document
      .querySelector('span[data-pane-layer-owned]')
      ?.shadowRoot?.querySelector('button')
      ?.click(),
  )
  assert(await hidden(), 'A synthetic page click activated a Layer control')
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.evaluate(() =>
      document.querySelector('span[data-pane-layer-owned]')?.remove(),
    )
    if (attempt < 4)
      await page.waitForFunction(() =>
        document.querySelector('span[data-pane-layer-owned]'),
      )
  }
  await page.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector('#recommendations') ?? document.body,
      ).display !== 'none',
  )
  assert(!(await hidden()), 'Repair circuit did not restore the page')
  await update([])
  await update([layer])
  await update([layer, { ...layer, id: 'second' }])
  await update([{ ...layer, id: 'second' }])
  assert(await hidden(), 'Disabling one layer undid another layer')
  await update([])
  assert(!(await hidden()), 'Disable did not restore recommendations')
  assert(
    (await page.$eval('#draft', (node) => (node as HTMLInputElement).value)) ===
      'unsaved draft',
    'Form state was changed',
  )
  await update([layer])
  await page.reload()
  await page.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector('#recommendations') ?? document.body,
      ).display === 'none',
  )
  const button = await page.evaluateHandle(() =>
    document
      .querySelector('span[data-pane-layer-owned]')
      ?.shadowRoot?.querySelector('button'),
  )
  const element = button.asElement()
  if (!element) throw new Error('Show control missing')
  await element.evaluate((button) => (button as HTMLElement).focus())
  await page.keyboard.press('Enter')
  assert(!(await hidden()), 'Real Show click did not restore recommendations')
  assert(
    await page.evaluate(
      () =>
        document.activeElement === document.querySelector('#recommendations'),
    ),
    'Keyboard Show lost focus when its button disappeared',
  )
  await page.keyboard.press('Tab')
  assert(
    await page.evaluate(
      () =>
        !document.querySelector('#recommendations')?.hasAttribute('tabindex'),
    ),
    'Temporary reveal focus changed site markup permanently',
  )
  await page.goto(`${origin}/articles/csp`)
  await page.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector('#recommendations') ?? document.body,
      ).display === 'none',
  )
  await page.goto(`${origin}/account`)
  await page.waitForFunction(() =>
    document.querySelector('style[data-pane-layer-owned]'),
  )
  assert(!(await hidden()), 'Layer leaked outside its path scope')
  const message = (payload: unknown) =>
    worker.evaluate(
      async (payload, origin) => {
        const tabs = await chrome.tabs.query({ url: `${origin}/*` })
        const tabId = tabs[0]?.id
        if (tabId === undefined) throw new Error('Fixture tab missing')
        return chrome.tabs.sendMessage(tabId, payload)
      },
      payload,
      origin,
    )
  const input = (await message({ kind: 'capture' })) as {
    targetLanguage: string
    blocks: Array<{ blockId: string; text: string }>
  }
  assert(
    input.blocks.length === 2,
    'Readable snapshot did not capture heading and paragraph',
  )
  const data = {
    schema: 'pane.translation.v1',
    targetLanguage: 'en',
    blocks: input.blocks.map((block) => ({
      blockId: block.blockId,
      translatedText: '<img src=x onerror=alert(1)> Fixture translation',
    })),
  }
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl'
  })
  assert(
    (await message({ kind: 'render', data })).status === 'rendered',
    'Typed fixture translation did not render',
  )
  assert(
    await page.evaluate(() => {
      const host = document.querySelector(
        '[data-pane-layer-owned="translation"]',
      )
      return (
        !host?.shadowRoot?.querySelector('img') &&
        host?.shadowRoot
          ?.querySelector('p')
          ?.textContent?.startsWith('<img') === true
      )
    }),
    'Translation output was interpreted as HTML',
  )
  assert(
    await page.evaluate(() => {
      const paragraph = document
        .querySelector('[data-pane-layer-owned="translation"]')
        ?.shadowRoot?.querySelector('p')
      return (
        paragraph?.lang === 'en' &&
        getComputedStyle(paragraph).direction === 'ltr'
      )
    }),
    'English translation inherited RTL direction',
  )
  await page.evaluate(() => {
    document.documentElement.dir = 'ltr'
  })
  const arabic = await message({ kind: 'capture', language: 'ar' })
  await message({
    kind: 'render',
    data: {
      schema: 'pane.translation.v1',
      targetLanguage: 'ar',
      blocks: arabic.blocks.map((block: { blockId: string }) => ({
        blockId: block.blockId,
        translatedText: 'ترجمة النص إلى العربية',
      })),
    },
  })
  assert(
    await page.evaluate(() => {
      const paragraph = document
        .querySelector('[data-pane-layer-owned="translation"]')
        ?.shadowRoot?.querySelector('p')
      return (
        paragraph?.lang === 'ar' &&
        getComputedStyle(paragraph).direction === 'rtl'
      )
    }),
    'Arabic translation inherited LTR direction',
  )
  await page.$eval('article p', (node) => {
    node.textContent = 'Source changed while result was visible'
  })
  await page.waitForFunction(
    () => !document.querySelector('[data-pane-layer-owned="translation"]'),
  )
  assert(
    (await message({ kind: 'render', data })).status === 'stale',
    'Stale snapshot rendered after source mutation',
  )
  console.log(
    JSON.stringify(
      {
        browser: await browser.version(),
        userScripts: support,
        managedChecks: [
          'mount',
          'strict page CSP',
          'host-removal recovery',
          'bounded repair circuit',
          'synthetic click rejection',
          'bounded text snapshot',
          'text-only translation rendering',
          'source mutation invalidation',
          'overlapping owners',
          'disable',
          'form preservation',
          'storage reload',
          'trusted Show click',
          'keyboard Show retains position and restores temporary tabindex',
          'English translation direction in an RTL page',
          'Arabic translation direction in an LTR page',
          'route exclusion',
        ],
        passed: true,
      },
      null,
      2,
    ),
  )
} finally {
  await browser?.close()
  fixture?.stop(true)
  // Only this script's disposable profile and fixture extension are removed.
  await rm(dir, { recursive: true, force: true })
}
