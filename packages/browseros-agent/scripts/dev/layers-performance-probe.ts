/** Measures the production managed interpreter on a synthetic 5,000-node feed. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const dir = await mkdtemp(join(tmpdir(), 'pane-layers-performance-'))
const entry = join(dir, 'entry.ts')
await writeFile(
  entry,
  `import {ManagedLayerRuntime} from ${JSON.stringify(resolve(import.meta.dir, '../../apps/app/lib/layers/runtime.ts'))}; globalThis.createRuntime=()=>new ManagedLayerRuntime(document);`,
)
const build = await Bun.build({
  entrypoints: [entry],
  outdir: dir,
  naming: 'runtime.js',
  target: 'browser',
  format: 'iife',
})
if (!build.success) throw new Error('Performance fixture compilation failed')
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: () =>
    new Response('<!doctype html><body><main></main></body>', {
      headers: { 'content-type': 'text/html' },
    }),
})
const browser = await puppeteer.launch({
  executablePath:
    process.env.PANE_TEST_EXECUTABLE ||
    '/Users/abhishek/chromium/src/out/Default_arm64/Pane.app/Contents/MacOS/Pane',
  headless: true,
  userDataDir: join(dir, 'profile'),
  args: [
    '--disable-browseros-server',
    '--disable-background-networking',
    '--no-first-run',
  ],
})
try {
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.port}`)
  await page.setContent('<!doctype html><body><main></main></body>')
  await page.evaluate(() => {
    document.querySelector('main')!.innerHTML = Array.from(
      { length: 5000 },
      (_, i) => `<section id="item-${i}"><p>Article ${i}</p></section>`,
    ).join('')
  })
  await page.addScriptTag({ path: join(dir, 'runtime.js') })
  const result = await page.evaluate(async () => {
    const root = globalThis as any
    const scope = {
      origin: location.origin,
      paths: ['/*'],
      excludePaths: [],
      query: {},
    }
    const layer = {
      id: 'performance',
      version: 'a'.repeat(64),
      definition: {
        protocol: 'pane.layers.v1',
        name: 'Highlight',
        intent: 'Benchmark',
        mode: 'managed',
        scope,
        actions: [],
        operations: Array.from({ length: 20 }, (_, i) => ({
          id: `mark-${i}`,
          kind: 'highlight',
          anchor: { selector: `#item-${i * 100}`, maxMatches: 1 },
        })),
      },
    }
    const runtime = root.createRuntime()
    const samples: number[] = []
    for (let i = 0; i < 25; i++) {
      const start = performance.now()
      runtime.update([layer])
      if (
        runtime
          .inspect(layer.id)
          .reduce((n: any, op: any) => n + op.affectedElements, 0) !== 20
      )
        throw new Error('Expected twenty mounted targets')
      samples.push(performance.now() - start)
      runtime.update([])
    }
    const churn = async () => {
      const start = performance.now()
      for (let i = 0; i < 60; i++) {
        for (let j = 0; j < 50; j++)
          document
            .getElementById(`item-${j}`)!
            .querySelector('p')!.textContent = `Tick ${i}`
        window.scrollTo(0, i * 100)
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        )
      }
      return performance.now() - start
    }
    const baselineMs = await churn()
    runtime.update([layer])
    const layersMs = await churn()
    runtime.dispose()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const residual = document.querySelectorAll(
      '[data-pane-layer-owned], [class*="pane-layer-"]',
    ).length
    samples.sort((a, b) => a - b)
    return {
      nodes: 5000,
      operations: 20,
      mountP95Ms: samples[Math.floor(samples.length * 0.95)],
      mountMaxMs: samples.at(-1),
      baselineChurnMs: baselineMs,
      layersChurnMs: layersMs,
      residual,
    }
  })
  if (result.residual !== 0) throw new Error('Disposal left owned DOM behind')
  if (result.mountP95Ms > 100)
    throw new Error(`Mount p95 exceeds 100ms: ${result.mountP95Ms}`)
  if (result.layersChurnMs > result.baselineChurnMs * 1.5 + 100)
    throw new Error('Feed churn exceeded the regression budget')
  console.log(JSON.stringify(result, null, 2))
} finally {
  server.stop(true)
  await browser.close()
  await rm(dir, { recursive: true, force: true })
}
