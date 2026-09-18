import { runLayerTranslation } from '../../apps/server/src/layers/action-runner'
import { anthropicFixtureResponse } from './layers-anthropic-fixture'
import { codexFixtureResponse } from './layers-codex-fixture'
/** Disposable Chromium profile + actual background/content/runtime + Layer
 * HTTP routes and action harness. Native credential delivery and provider
 * configuration use fixture dependencies; no user account or paid model. */

import { Database } from 'bun:sqlite'
import { createHmac, randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { buildLayerAuthoringTools } from '../../apps/server/src/layers/authoring'
import { LayerBroker } from '../../apps/server/src/layers/broker'
import {
  LAYER_EXTENSION_ID,
  LayerAuthority,
  withLayerAccess,
} from '../../apps/server/src/layers/broker-auth'
import { runClaudeLayerAction } from '../../apps/server/src/layers/claude-action-runner'
import { LayerDataBroker } from '../../apps/server/src/layers/data-broker'
import { createLayerRoutes } from '../../apps/server/src/layers/routes'
import { LayerStore } from '../../apps/server/src/layers/store'
import { LAYER_ACTIVITY_SCHEMA_SQL } from '../../apps/server/src/lib/db/schema/layer-activity'
import { LAYERS_SCHEMA_SQL } from '../../apps/server/src/lib/db/schema/layers'
import { runWithProfile } from '../../apps/server/src/lib/profile-context'
import {
  isDataInput,
  isPageTaskInput,
  isScriptTaskInput,
  type LayerActionInput,
} from '../../packages/shared/src/layers/action-protocol'
import { checkLayersAccessibility } from './layers-accessibility-checks'

const testCodex = process.argv.includes('--codex')
const testClaude = process.argv.includes('--claude')
const testScripts =
  process.argv.includes('--scripts') || testClaude || testCodex
const generatedRequestCount = testClaude ? 6 : 5
const scriptChecks: string[] = []
const claudeInitModels = new Set<string>()
let recoveryTiming: { initializationMs: number; pauseMs: number } | undefined
const root = resolve(import.meta.dir, '../..')
const dir = await mkdtemp(join(tmpdir(), 'pane-layers-integration-'))
const db = new Database(':memory:')
db.exec(LAYERS_SCHEMA_SQL + LAYER_ACTIVITY_SCHEMA_SQL)
const store = new LayerStore(db)
const profileId = randomUUID()
const secret = 'ab'.repeat(32)
const broker = new LayerBroker()
const dataCalls: string[] = []
let releaseData: (() => void) | undefined
const dataBroker = new LayerDataBroker(async (url) => {
  dataCalls.push(url)
  if (url.endsWith('/openai/delayed'))
    await new Promise<void>((resolve) => {
      releaseData = resolve
    })
  return Response.json({
    private: false,
    stargazers_count: url.endsWith('/openai/codex')
      ? 42
      : url.endsWith('/openai/delayed')
        ? 99
        : 0,
    forks_count: 7,
  })
})
const app = createLayerRoutes({
  dataBroker,
  actionRunner: testCodex
    ? (run) =>
        runLayerTranslation(run, {
          codex: {
            binary: Bun.which('codex') ?? '/Users/abhishek/.local/bin/codex',
            nativeAuth: false,
            env: { PATH: process.env.PATH },
            upstream: (body, signal) =>
              codexFixtureResponse(origin, body, signal),
          },
        })
    : testClaude
      ? (run) =>
          runClaudeLayerAction(run, {
            binary: process.env.PANE_LAYER_TEST_CLAUDE_BINARY,
            observeInit: (event) => {
              if (typeof event.model === 'string')
                claudeInitModels.add(event.model)
            },
          })
      : undefined,
  authority: new LayerAuthority(secret),
  broker,
  store: () => store,
})
let browser: Browser | undefined
let modelCalls = 0
let delayed: (() => void) | undefined
let delayNext = false
let denyClaudeAccount = false
let brokerOffline = false
let dropNextActionResponse = true
let resultReplays = 0
let holdEnableResponse = false
let enableResponseHeld = false
let releaseEnableResponse: (() => void) | undefined
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.startsWith('/layers/')) {
      if (brokerOffline)
        return Response.json(
          { error: 'Fixture broker offline' },
          { status: 503 },
        )
      const url = new URL(request.url)
      url.pathname = path.slice('/layers'.length)
      if (url.pathname === '/actions/replay') resultReplays++
      const mutation =
        url.pathname === '/mutate'
          ? ((await request.clone().json()) as { action: string })
          : undefined
      const response = await app.fetch(new Request(url, request))
      if (holdEnableResponse && mutation?.action === 'enable' && response.ok) {
        enableResponseHeld = true
        await new Promise<void>((resolve) => {
          releaseEnableResponse = resolve
        })
      }

      if (
        url.pathname === '/actions/run' &&
        response.ok &&
        dropNextActionResponse
      ) {
        dropNextActionResponse = false
        return new Response('{', {
          headers: { 'content-type': 'application/json' },
        })
      }
      return response
    }
    if (path === '/v1/messages') {
      if (denyClaudeAccount)
        return Response.json(
          {
            type: 'error',
            error: {
              type: 'permission_error',
              message:
                'Your organization has disabled Claude subscription access for Claude Code private-fixture-detail',
            },
          },
          { status: 403 },
        )

      const body = (await request.json()) as {
        model: string
        tools?: Array<{ name: string }>
        messages: Array<{
          role: string
          content:
            | string
            | Array<{ type: string; text?: string; content?: unknown }>
        }>
      }
      const tools = body.tools ?? []
      const generated = tools.some((tool) =>
        tool.name.endsWith('__page_execute_script'),
      )
      const messages = body.messages.flatMap((message) =>
        typeof message.content === 'string'
          ? [{ role: message.role, content: message.content }]
          : message.content.flatMap((block) =>
              block.type === 'text'
                ? [{ role: message.role, content: block.text ?? '' }]
                : block.type === 'tool_result'
                  ? [{ role: 'tool', content: JSON.stringify(block.content) }]
                  : [],
            ),
      )
      if (
        generated &&
        messages.filter((message) => message.role === 'tool').length >= 5
      ) {
        modelCalls++
        return anthropicFixtureResponse(body.model, {
          type: 'text',
          text: 'Completed.',
        })
      }
      const parsedMessages = generated
        ? messages
        : messages.filter((message) => {
            try {
              return (
                message.role === 'user' && JSON.parse(message.content).input
              )
            } catch {
              return false
            }
          })
      const converted = await fetch(
        new URL('/v1/chat/completions', request.url),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            messages: parsedMessages,
            tools: generated
              ? tools.map((tool) => ({
                  function: {
                    name: tool.name.replace('mcp__pane_layer__', ''),
                  },
                }))
              : [],
          }),
        },
      )
      const result = (await converted.json()) as {
        choices: Array<{
          message: {
            tool_calls: Array<{ function: { name: string; arguments: string } }>
          }
        }>
      }
      const call = result.choices[0].message.tool_calls[0].function
      const name = generated
        ? 'mcp__pane_layer__' + call.name
        : 'StructuredOutput'
      return anthropicFixtureResponse(body.model, {
        type: 'tool_use',
        id: 'tool-' + crypto.randomUUID(),
        name,
        input: JSON.parse(call.arguments),
      })
    }
    if (path === '/v1/chat/completions') {
      modelCalls += 1
      const body = (await request.json()) as {
        messages: Array<{ role: string; content: string }>
        tools?: Array<{ function: { name: string } }>
      }
      if (
        body.tools?.some((tool) => tool.function.name === 'page_execute_script')
      ) {
        const toolTurns = body.messages.filter(
          (message) => message.role === 'tool',
        ).length
        const name =
          toolTurns === 0 || toolTurns === 2
            ? 'page_inspect'
            : toolTurns === 1 || toolTurns === 3
              ? 'page_execute_script'
              : 'complete_page_task'
        const args =
          name === 'page_execute_script'
            ? {
                source:
                  toolTurns === 1
                    ? `(() => {const output=document.createElement('p');output.id='generated-result';output.textContent='First attempt';document.body.append(paneLayer.own(output));})();`
                    : `(() => {document.querySelector('#generated-result').textContent='Adapted by agent';})();`,
                assertions: [
                  {
                    id: 'adapted',
                    selector: '#generated-result',
                    state: 'visible',
                    textIncludes: 'Adapted by agent',
                  },
                ],
              }
            : {}
        return Response.json({
          id: 'script-fixture',
          object: 'chat.completion',
          created: 1,
          model: 'fixture',
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'script-tool-' + toolTurns,
                    type: 'function',
                    function: { name, arguments: JSON.stringify(args) },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        })
      }
      const source = JSON.parse(
        body.messages.findLast((message) => message.role === 'user')?.content ??
          '{}',
      ).input as LayerActionInput
      if (isScriptTaskInput(source))
        throw new Error('Generated task reached ordinary result fixture')
      if (isDataInput(source)) throw new Error('Data reached the model')
      if (delayNext) {
        delayNext = false
        await new Promise<void>((resolve) => {
          delayed = resolve
        })
      }
      return Response.json({
        id: 'fixture',
        object: 'chat.completion',
        created: 1,
        model: 'fixture',
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'fixture-result',
                  type: 'function',
                  function: {
                    name: 'submit_layer_result',
                    arguments: JSON.stringify(
                      isPageTaskInput(source)
                        ? {
                            schema: 'pane.page-task-receipt.v1',
                            operations: source.nodes
                              .filter((node) => node.role === 'aside')
                              .map((node) => ({
                                nodeId: node.nodeId,
                                kind: 'collapse',
                                label: 'recommendations',
                              })),
                          }
                        : {
                            schema: 'pane.translation.v1',
                            targetLanguage: source.targetLanguage,
                            blocks: source.blocks.map((block) => ({
                              blockId: block.blockId,
                              translatedText: `English fixture: ${block.text}`,
                            })),
                          },
                    ),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      })
    }
    return new Response(
      '<!doctype html><html><body><div id="layout"><article><h1>Bonjour</h1><p>Un article de test.</p></article><aside id="recommendations">Recommendations</aside><form><input id="draft" value="unsaved draft"></form><a class="repo" href="https://github.com/openai/codex">Codex</a><a class="repo" href="https://github.com/openai/codex">Codex duplicate</a></div></body></html>',
      {
        headers: {
          'Content-Type': 'text/html',
          'Content-Security-Policy':
            "default-src 'self'; script-src 'none'; style-src 'none'",
        },
      },
    )
  },
})
const origin = `http://127.0.0.1:${server.port}`
const claims = {
  profileId,
  extensionId: LAYER_EXTENSION_ID,
  expiresAt: Date.now() + 5 * 60_000,
}
const message = `pane.layers.auth.v1.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`
const authorization = `Bearer ${message}.${createHmac('sha256', secret).update(message).digest('base64url')}`
const authorTools = buildLayerAuthoringTools('fixture-provider', {
  broker,
  store: () => store,
})
async function author(name: string, input: Record<string, unknown>) {
  const execute = authorTools[name]?.execute
  if (!execute) throw new Error(`Missing authoring tool: ${name}`)
  const result = (await runWithProfile(profileId, () =>
    withLayerAccess(claims, authorization, () =>
      execute(input, { toolCallId: randomUUID(), messages: [] }),
    ),
  )) as { text: string }
  return JSON.parse(result.text)
}
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}
async function until(
  check: () => boolean | Promise<boolean>,
  label: string,
  timeout = 15_000,
) {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${label}`)
    await Bun.sleep(50)
  }
}
async function clickText(page: Page, text: string) {
  await page.bringToFront()
  const handle = await page.evaluateHandle((label) => {
    for (const host of document.querySelectorAll('[data-pane-layer-owned]'))
      for (const button of host.shadowRoot?.querySelectorAll('button') ?? [])
        if (button.textContent === label) return button
    return null
  }, text)
  const element = handle.asElement()
  if (!element) throw new Error(`Missing button: ${text}`)
  await element.click()
  await handle.dispose()
}
async function clickUiText(page: Page, label: string, articleName?: string) {
  await page.bringToFront()
  const handle = await page.evaluateHandle(
    ({ label, articleName }) => {
      const root = articleName
        ? Array.from(document.querySelectorAll('article')).find(
            (node) => node.querySelector('h2')?.textContent === articleName,
          )
        : document
      return (
        Array.from(root?.querySelectorAll('button,summary') ?? []).find(
          (node) => node.textContent === label,
        ) ?? null
      )
    },
    { label, articleName },
  )
  const element = handle.asElement()
  if (!element) throw new Error(`Missing library control: ${label}`)
  await element.click()
  await handle.dispose()
}
const watchdog = setTimeout(() => {
  console.error('Integration probe exceeded its 90-second deadline.')
  browser?.process()?.kill('SIGKILL')
  server.stop(true)
}, 90_000)
try {
  if (testClaude) {
    const config = join(dir, 'claude-config')
    await mkdir(config)
    process.env.CLAUDE_CONFIG_DIR = config
    process.env.ANTHROPIC_API_KEY = 'fixture-key'
    process.env.ANTHROPIC_BASE_URL = origin
  }
  console.log('Building disposable production-runtime extension')
  const config = await readFile(join(root, 'apps/app/wxt.config.ts'), 'utf8')
  const key = /key: '([^']+)'/.exec(config)?.[1]
  assert(key, 'Bundled extension key not found')
  await writeFile(
    join(dir, 'background-entry.ts'),
    `import { layersBridge } from ${JSON.stringify(join(root, 'apps/app/entrypoints/background/layers.ts'))}; layersBridge();`,
  )
  await writeFile(
    join(dir, 'content-entry.ts'),
    `globalThis.defineContentScript = (entry) => entry.main({onInvalidated:()=>{}}); import(${JSON.stringify(join(root, 'apps/app/entrypoints/layer-runtime.content.ts'))});`,
  )
  await writeFile(
    join(dir, 'ui-entry.ts'),
    `import React from ${JSON.stringify(Bun.resolveSync('react', join(root, 'apps/app')))}; import {createRoot} from ${JSON.stringify(Bun.resolveSync('react-dom/client', join(root, 'apps/app')))}; import {LayersPage} from ${JSON.stringify(join(root, 'apps/app/screens/layers/LayersPage.tsx'))}; createRoot(document.getElementById('root')).render(React.createElement(LayersPage));`,
  )
  for (const entry of ['background', 'content', 'ui']) {
    const result = await Bun.build({
      entrypoints: [join(dir, `${entry}-entry.ts`)],
      outdir: dir,
      naming: `${entry}.js`,
      target: 'browser',
      format: 'iife',
      plugins: [
        {
          name: 'disposable-layer-dependencies',
          setup(build) {
            build.onResolve({ filter: /^@\// }, ({ path }) => {
              if (
                [
                  '@/lib/browseros/profile-key',
                  '@/lib/layers/native',
                  '@/lib/llm-providers/storage',
                ].includes(path)
              )
                return { path, namespace: 'fixture' }
              return {
                path: Bun.resolveSync(
                  join(root, 'apps/app', path.slice(2)),
                  root,
                ),
              }
            })
            build.onLoad(
              { filter: /.*/, namespace: 'fixture' },
              ({ path }) => ({
                loader: 'ts',
                contents: path.endsWith('profile-key')
                  ? `export const getBrowserProfileKey = async () => ${JSON.stringify(profileId)};`
                  : path.endsWith('/native')
                    ? `export const getLayerCredential = async () => ({profileId:${JSON.stringify(profileId)}}); export const layerFetch = (path, init={}) => fetch(${JSON.stringify(origin)}+'/layers'+path, {...init,headers:{...init.headers,'Content-Type':'application/json',Authorization:${JSON.stringify(authorization)}}});`
                    : `export const loadProviders = async () => ['fixture-provider','unverified-provider'].map(id=>({id,type:${JSON.stringify(testCodex ? 'codex' : testClaude ? 'claude-code' : 'openai-compatible')},modelId:${JSON.stringify(testCodex ? 'gpt-5.5' : testClaude ? 'sonnet' : 'fixture')},updatedAt:1,baseUrl:${JSON.stringify(`${origin}/v1`)}}));`,
              }),
            )
          },
        },
      ],
    })
    if (!result.success) throw new Error(result.logs.map(String).join('\n'))
  }
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Pane Layers integration fixture',
      version: '1.0',
      key,
      permissions: [
        'storage',
        'tabs',
        'webNavigation',
        ...(testScripts ? ['browserOS', 'userScripts'] : []),
      ],
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
    join(dir, 'ui.html'),
    '<!doctype html><title>Layers fixture controls</title><div id="root"></div><script src="ui.js"></script>',
  )
  const builtHtml = await readFile(
    join(root, 'apps/app/dist/chrome-mv3-dev/layers.html'),
    'utf8',
  )
  const stylesheet = /href="([^"]+\.css)"/.exec(builtHtml)?.[1]
  if (!stylesheet)
    throw new Error(
      'Build the development extension before running this UI probe.',
    )
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(
    join(dir, stylesheet),
    await readFile(join(root, 'apps/app/dist/chrome-mv3-dev', stylesheet)),
  )
  for (const font of ['geist', 'geist-mono'])
    await cp(
      join(root, 'apps/app/dist/chrome-mv3-dev', font),
      join(dir, font),
      { recursive: true },
    )
  const fixtureHtml = await readFile(join(dir, 'ui.html'), 'utf8')
  await writeFile(
    join(dir, 'ui.html'),
    fixtureHtml.replace(
      '<title>',
      `<meta charset="UTF-8"><link rel="stylesheet" href="${stylesheet}"><title>`,
    ),
  )
  browser = await puppeteer.launch({
    executablePath:
      process.env.PANE_TEST_EXECUTABLE ||
      (testScripts
        ? '/Users/abhishek/chromium/src/out/Default_arm64/Pane.app/Contents/MacOS/Pane'
        : '/Applications/Pane.app/Contents/MacOS/Pane'),
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
  if (testScripts) {
    const workerTarget = await browser.waitForTarget(
      (target) => target.type() === 'service_worker',
    )
    const worker = await workerTarget.worker()
    assert(worker, 'No extension worker')
    // Exercise native default provisioning in this disposable profile. This
    // fixture uses injected credentials; native minting is covered separately.
    await worker!.evaluate(
      () =>
        new Promise<void>((resolve) => {
          ;(chrome as any).browserOS.getLayerCredential(() => {
            void chrome.runtime.lastError
            resolve()
          })
        }),
    )
    await worker!.evaluate(() => chrome.userScripts.getScripts())
  }
  await until(() => broker.ready(profileId), 'browser profile connection')
  const emptyState = await author('layer_list', {})
  assert(
    emptyState.runtimeAvailable && emptyState.documents.length === 0,
    'Layer state required an open website',
  )
  console.log('Browser launched; testing document registration')
  const page = await browser.newPage()
  await page.goto(`${origin}/articles/one`)
  await page.waitForFunction(() =>
    document.querySelector('style[data-pane-layer-owned]'),
  )
  await until(
    () => broker.documents(profileId).length > 0,
    'document registration',
  )
  const ui = await browser.newPage()
  await ui.goto(`chrome-extension://${LAYER_EXTENSION_ID}/ui.html`)
  const mutate = (action: string, extra: Record<string, unknown> = {}) =>
    ui.evaluate(
      (input) =>
        chrome.runtime.sendMessage({
          channel: 'pane.layers.v1',
          kind: 'ui',
          ...input,
        }),
      { action, revision: store.revision(), ...extra },
    )
  const target = () => {
    const doc = broker
      .documents(profileId)
      .find((doc) => doc.url === page.url())
    if (!doc) throw new Error('No current document')
    return doc
  }
  console.log('Document registered; testing managed persistence')
  const draft = store.draft(
    {
      protocol: 'pane.layers.v1',
      name: 'Quiet article',
      intent: 'Hide recommendations on article pages',
      mode: 'managed',
      scope: { origin, paths: ['/articles/*'] },
      operations: [
        {
          id: 'hide',
          kind: 'collapse',
          label: 'Recommendations',
          anchor: { selector: '#recommendations' },
        },
      ],
    },
    store.revision(),
  )
  const layer = store.version(draft.id, draft.latestVersion)
  let incompleteError = ''
  try {
    await author('layer_enable', { id: layer.id, revision: store.revision() })
  } catch (error) {
    incompleteError = String(error)
  }
  assert(
    incompleteError.includes('layer_verify') && !store.read(layer.id).enabled,
    'Incomplete draft enable did not explain verification',
  )
  await author('layer_disable', { id: layer.id, revision: store.revision() })
  await author('layer_preview', {
    id: layer.id,
    version: layer.version,
    tabId: target().tabId,
  })
  assert(
    !store.read(layer.id).enabled && !store.read(layer.id).activeVersion,
    'Draft preview installed an unverified Layer',
  )
  broker.registerPreview(profileId, target(), layer.id, layer.version)
  const hidden = () =>
    page.evaluate(
      () =>
        getComputedStyle(document.querySelector('#recommendations')!)
          .display === 'none',
    )
  assert(await hidden(), 'Preview did not collapse target')
  const proof = await author('layer_verify', {
    id: layer.id,
    version: layer.version,
    tabId: target().tabId,
  })
  assert(
    proof.passed && proof.checks.reloaded,
    'Production authoring verification failed',
  )
  assert(proof.kept && proof.enabled, 'Verification did not enable the Layer')
  await author('layer_clear_preview', { tabId: target().tabId })
  await mutate('disable', { id: layer.id })
  const enableRevision = store.revision()
  holdEnableResponse = true
  const enabling = author('layer_enable', {
    id: layer.id,
    revision: enableRevision,
  })
  await until(() => enableResponseHeld, 'delayed enable response')
  const newerDisable = await mutate('disable', {
    id: layer.id,
    revision: enableRevision,
  })
  assert(
    newerDisable.disabledLocally,
    'Conflicting newer disable was not retained locally',
  )
  releaseEnableResponse?.()
  const supersededEnable = await enabling
  holdEnableResponse = false
  assert(
    !supersededEnable.enabled && supersededEnable.record.disabledLocally,
    'Older agent enable overrode newer UI disable',
  )
  const afterLateReply = await mutate('state')
  assert(
    afterLateReply.local.disabledIds.includes(layer.id),
    'UI lost newer local disable',
  )
  await until(
    async () => !(await hidden()),
    'newer disable still removes effects',
  )
  await author('layer_enable', { id: layer.id, revision: store.revision() })
  await until(hidden, 'explicit enable after racing disable')

  await page.reload()
  await until(hidden, 'saved mount after reload')
  assert(modelCalls === 0, 'Local Layer caused model work')
  assert(
    (await page.$eval(
      '#draft',
      (input) => (input as HTMLInputElement).value,
    )) === 'unsaved draft',
    'Form contents changed',
  )
  await mutate('disable', { id: layer.id })
  await until(async () => !(await hidden()), 'disable cleanup')
  // Simulate the old agent path: server enabled, browser override still disabled.
  store.enable(layer.id, broker.capabilities(profileId), store.revision())
  broker.wake(profileId)
  const disabledState = await author('layer_list', {})
  assert(
    disabledState.records.some(
      (record: any) =>
        record.id === layer.id &&
        record.savedEnabled &&
        !record.enabled &&
        record.disabledLocally &&
        record.status === 'disabled',
    ),
    'Agent did not see the durable browser disable override',
  )
  const enabled = await author('layer_enable', {
    id: layer.id,
    revision: disabledState.revision,
  })
  assert(
    enabled.enabled && !enabled.record.disabledLocally,
    'Agent enable did not acknowledge the browser override',
  )
  await until(hidden, 'agent re-enable mount')
  const uiState = await mutate('state')
  assert(
    !uiState.local.disabledIds.includes(layer.id),
    'Agent enable left UI disabled',
  )
  await author('layer_set_paused', {
    paused: true,
    origin,
    revision: store.revision(),
  })
  const pausedState = await author('layer_list', {})
  assert(
    pausedState.records.find((record: any) => record.id === layer.id)
      ?.status === 'paused',
    'Agent missed the site pause',
  )
  await until(async () => !(await hidden()), 'agent site pause cleanup')
  await author('layer_set_paused', {
    paused: false,
    origin,
    revision: pausedState.revision,
  })
  await until(hidden, 'agent site resume')
  await author('layer_disable', { id: layer.id, revision: store.revision() })
  await until(async () => !(await hidden()), 'agent disable cleanup')
  await author('layer_enable', { id: layer.id, revision: store.revision() })
  await until(hidden, 'agent enable after agent disable')
  await page.evaluate(() => {
    const state = window as any
    state.layerCacheRestores = 0
    state.layerCacheDraft = document.querySelector('#draft')
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) state.layerCacheRestores++
    })
  })
  await page.goto(`${origin}/excluded`)
  await page.goBack()
  await page.waitForFunction(() => (window as any).layerCacheRestores === 1)
  await until(hidden, 'managed BFCache remount')
  assert(
    await page.evaluate(
      () =>
        (window as any).layerCacheDraft === document.querySelector('#draft') &&
        (document.querySelector('#draft') as HTMLInputElement).value ===
          'unsaved draft',
    ),
    'BFCache did not retain the original form',
  )
  await page.evaluate(() => {
    const state = window as any,
      node = document.querySelector('#recommendations')!
    const hiddenClasses = [...node.classList].filter((name) =>
      name.endsWith('-hidden'),
    )
    state.revokedLayerReapplied = false
    new MutationObserver(() => {
      if (hiddenClasses.some((name) => node.classList.contains(name)))
        state.revokedLayerReapplied = true
    }).observe(node, { attributes: true, attributeFilter: ['class'] })
  })
  await page.goto(`${origin}/excluded`)
  await mutate('disable', { id: layer.id })
  await page.goBack()
  await page.waitForFunction(() => (window as any).layerCacheRestores === 2)
  await until(
    async () => !(await hidden()),
    'cached disabled Layer remains absent',
  )
  await until(
    () => broker.documents(profileId).some((doc) => doc.url === page.url()),
    'restored document registration',
  )
  assert(
    await page.evaluate(() => !(window as any).revokedLayerReapplied),
    'A cached revoked Layer was briefly reapplied',
  )
  await mutate('enable', { id: layer.id })
  await until(hidden, 'enable after cache restoration')
  console.log(
    'Checking multiple windows, worker termination and offline recovery',
  )
  const windowId = await ui.evaluate(
    async (url) => (await chrome.windows.create({ url })).id!,
    `${origin}/articles/second-window`,
  )
  const secondTarget = await browser.waitForTarget(
    (t) => t.url() === `${origin}/articles/second-window`,
  )
  const second = await secondTarget.page()
  assert(second, 'Second-window page missing')
  await second!.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('#recommendations')!).display ===
      'none',
  )
  await mutate('disable', { id: layer.id })
  await until(async () => !(await hidden()), 'first-window disable')
  await second!.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('#recommendations')!).display !==
      'none',
  )
  await mutate('enable', { id: layer.id })
  await until(hidden, 'first-window restore')
  await ui.evaluate((id) => chrome.windows.remove(id), windowId)
  const previousSession = broker.session(profileId)
  const restartTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker',
  )
  const restartWorker = await restartTarget.worker()
  assert(restartWorker, 'Worker missing before termination')
  await restartWorker!.close()
  // A trusted UI request wakes the actual terminated worker.
  await ui
    .evaluate(() =>
      chrome.runtime.sendMessage({
        channel: 'pane.layers.v1',
        kind: 'ui',
        action: 'state',
      }),
    )
    .catch(() => {})
  await until(
    () =>
      broker.session(profileId) !== previousSession && broker.ready(profileId),
    'fresh worker session',
    25_000,
  )
  await until(hidden, 'worker restart preserves saved effect')
  brokerOffline = true
  const offlineDisable = await mutate('disable', { id: layer.id })
  assert(
    offlineDisable.disabledLocally,
    'Offline disable was not acknowledged locally',
  )
  await until(async () => !(await hidden()), 'offline disable cleanup')
  await page.reload()
  await page.waitForFunction(() =>
    document.querySelector('style[data-pane-layer-owned]'),
  )
  assert(!(await hidden()), 'Offline reload lost local revocation')
  brokerOffline = false
  await until(() => broker.ready(profileId), 'broker reconnect')
  await mutate('enable', { id: layer.id })
  await until(hidden, 'explicit re-enable after offline revocation')
  scriptChecks.push(
    'multiple-window mount and revocation',
    'actual service-worker termination and reconnect',
    'offline disable survives reload and reconnect',
  )

  await page.evaluate(() => history.pushState({}, '', '/excluded'))
  await until(async () => !(await hidden()), 'SPA exclusion cleanup')
  await page.goto(`${origin}/articles/two`)
  await until(hidden, 'revisit persistence')
  await until(
    () => broker.documents(profileId).some((doc) => doc.url === page.url()),
    'new originating document',
  )
  console.log('Managed persistence passed; testing translation')
  const translation = store.draft(
    {
      protocol: 'pane.layers.v1',
      name: 'Translate article',
      intent: 'Translate readable article text on click',
      mode: 'managed',
      scope: { origin, paths: ['/articles/*'] },
      operations: [
        {
          id: 'translate-button',
          kind: 'button',
          anchor: { selector: 'article' },
          label: 'Translate',
          actionId: 'translate',
        },
      ],
      actions: [
        {
          id: 'translate',
          kind: 'transform',
          trigger: 'click',
          instruction: 'Translate to English.',
          targetLanguage: 'en',
          providerId: 'fixture-provider',
          outputSchema: 'pane.translation.v1',
          limits: { maxSteps: 2, maxOutputTokens: 1000, deadlineMs: 10000 },
        },
      ],
    },
    store.revision(),
  )
  broker.wake(profileId)
  await until(async () => {
    const value = await ui.evaluate(() =>
      chrome.runtime.sendMessage({
        channel: 'pane.layers.v1',
        kind: 'ui',
        action: 'state',
      }),
    )
    return value.local?.manifest?.revision === store.revision()
  }, 'draft cache revision')
  const translationLayer = store.version(
    translation.id,
    translation.latestVersion,
  )
  await broker.command(profileId, 'preview', translationLayer, target())
  broker.registerPreview(
    profileId,
    target(),
    translationLayer.id,
    translationLayer.version,
  )
  await page.evaluate(() => {
    for (const host of document.querySelectorAll('[data-pane-layer-owned]'))
      for (const button of host.shadowRoot?.querySelectorAll('button') ?? [])
        if (button.textContent === 'Translate · Pane') button.click()
  })
  await Bun.sleep(100)
  assert(modelCalls === 0, 'Synthetic click invoked the model')
  console.log('Clicking translation control')
  await clickText(page, 'Translate · Pane')
  await until(
    () =>
      page.evaluate(
        () =>
          document.querySelectorAll('[data-pane-layer-owned="translation"]')
            .length === 2,
      ),
    'typed translation rendering',
  )
  assert(modelCalls === 1, 'Translation used unexpected provider calls')
  assert(resultReplays === 1, 'Lost result was not recovered through replay')
  scriptChecks.push('lost response replay without another model request')
  assert(
    (await page.$eval('article p', (p) => p.textContent)) ===
      'Un article de test.',
    'Translation replaced original text',
  )
  assert(
    broker.capabilities(profileId, 'fixture-provider').provider === 'ready',
    'Successful provider was not verified',
  )
  console.log('Translation rendered; testing Undo and cancellation')
  await clickText(page, 'Undo translation')
  assert(
    await page.evaluate(
      () =>
        document.querySelectorAll('[data-pane-layer-owned="translation"]')
          .length === 0,
    ),
    'Undo left translation output',
  )
  delayNext = true
  console.log('Clicking translation control')
  await clickText(page, 'Translate · Pane')
  await until(() => modelCalls === 2, 'delayed provider start')
  await clickText(page, 'Cancel')
  delayed?.()
  await Bun.sleep(300)
  assert(
    await page.evaluate(
      () =>
        document.querySelectorAll('[data-pane-layer-owned="translation"]')
          .length === 0,
    ),
    'Cancelled output rendered late',
  )
  console.log('Testing Stop from the production library')
  delayNext = true
  const beforeStop = modelCalls
  await clickText(page, 'Translate · Pane')
  await until(
    () => modelCalls === beforeStop + 1,
    'library-stop provider start',
  )
  await ui.bringToFront()
  await ui.waitForSelector('button[aria-label="Refresh Layers"]')
  await ui.click('button[aria-label="Refresh Layers"]')
  await clickUiText(ui, 'Recent activity')
  await ui.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent === 'Stop',
    ),
  )
  await clickUiText(ui, 'Stop')
  delayed?.()
  await until(
    () => store.activity().some((run) => run.status === 'cancelled'),
    'library cancellation recorded',
  )
  await Bun.sleep(200)
  assert(
    await page.evaluate(
      () =>
        document.querySelectorAll('[data-pane-layer-owned="translation"]')
          .length === 0,
    ),
    'Stopped action rendered late',
  )
  console.log('Testing adaptive page actions')
  await author('layer_clear_preview', { tabId: target().tabId })
  await mutate('disable', { id: layer.id })
  await until(async () => !(await hidden()), 'restore before adaptive capture')
  const focus = await author('layer_draft', {
    revision: store.revision(),
    definition: {
      protocol: 'pane.layers.v1',
      name: 'Focus',
      intent: 'Hide recommendations on demand',
      mode: 'managed',
      scope: { origin, paths: ['/articles/*'] },
      operations: [
        {
          id: 'focus-button',
          kind: 'button',
          anchor: { selector: '#layout' },
          label: 'Focus',
          actionId: 'focus',
        },
      ],
      actions: [
        {
          id: 'focus',
          kind: 'page-task',
          trigger: 'click',
          instruction:
            'Collapse the recommendations aside; preserve the article.',
          outputSchema: 'pane.page-task-receipt.v1',
          limits: { maxSteps: 2, maxOutputTokens: 1000, deadlineMs: 10000 },
        },
      ],
    },
  })
  assert(focus.saved, `Focus draft failed: ${JSON.stringify(focus)}`)
  const focusTarget = {
    id: focus.record.id,
    version: focus.record.latestVersion,
    tabId: target().tabId,
  }
  await author('layer_preview', focusTarget)
  await clickText(page, 'Focus · Pane')
  await until(hidden, 'adaptive scoped collapse')
  const focusProof = await author('layer_verify', focusTarget)
  assert(
    focusProof.passed,
    `Focus action verification failed: ${JSON.stringify(focusProof)}`,
  )
  await clickText(page, 'Undo changes')
  assert(!(await hidden()), 'Adaptive undo left hidden content')
  assert(
    (await page.$eval(
      '#draft',
      (input) => (input as HTMLInputElement).value,
    )) === 'unsaved draft',
    'Adaptive action changed form data',
  )
  delayNext = true
  const beforeStaleCall = modelCalls
  await clickText(page, 'Focus · Pane')
  await until(
    () => modelCalls === beforeStaleCall + 1,
    'adaptive delayed start',
  )
  await page.$eval('#recommendations', (node) => {
    node.textContent = 'Changed recommendations'
  })
  await Bun.sleep(300)
  delayed?.()
  await Bun.sleep(300)
  assert(!(await hidden()), 'Adaptive stale plan was applied')
  console.log('Testing registered data enrichment')
  await author('layer_clear_preview', { tabId: target().tabId })
  const beforeDataModels = modelCalls
  const data = await author('layer_draft', {
    revision: store.revision(),
    definition: {
      protocol: 'pane.layers.v1',
      name: 'Repository stars',
      intent: 'Show public repository stars next to repository links',
      mode: 'managed',
      scope: { origin, paths: ['/articles/*'] },
      operations: [
        {
          id: 'stars',
          kind: 'data-badge',
          anchor: { selector: 'a.repo', maxMatches: 10 },
          label: 'Stars',
          actionId: 'counts',
          field: 'stars',
        },
      ],
      actions: [
        {
          id: 'counts',
          kind: 'data',
          trigger: 'document-load',
          instruction: 'Read public repository counts.',
          dataOperationId: 'github.repository.stats',
          outputSchema: 'pane.data.v1',
          limits: { maxSteps: 1, maxOutputTokens: 128, deadlineMs: 10000 },
        },
      ],
    },
  })
  assert(data.saved, `Data draft failed: ${JSON.stringify(data)}`)
  const dataTarget = {
    id: data.record.id,
    version: data.record.latestVersion,
    tabId: target().tabId,
  }
  await page.bringToFront()
  await author('layer_preview', dataTarget)
  const badges = () =>
    page.evaluate(() =>
      Array.from(
        document.querySelectorAll('[data-pane-layer-owned="data"]'),
      ).map((host) => host.shadowRoot?.querySelector('span')?.textContent),
    )
  await until(
    async () =>
      (await badges()).filter((text) => text === 'Stars: 42').length === 2,
    'batched repository badges',
  ).catch(async (error) => {
    console.error('Data diagnostics', {
      badges: await badges(),
      dataCalls,
      inspection: await author('layer_inspect', { tabId: target().tabId }),
    })
    throw error
  })
  assert(
    dataCalls.length === 1,
    'Duplicate entities caused duplicate network requests',
  )
  assert(modelCalls === beforeDataModels, 'Data enrichment invoked a model')
  const dataProof = await author('layer_verify', dataTarget)
  assert(
    dataProof.passed,
    `Data verification failed: ${JSON.stringify(dataProof)}`,
  )
  assert(
    dataProof.kept && dataProof.enabled,
    'Data verification did not enable the Layer',
  )
  await page.reload()
  await page.bringToFront()
  await until(
    async () =>
      (await badges()).filter((text) => text === 'Stars: 42').length === 2,
    'persistent data badge',
  )
  assert(dataCalls.length === 1, 'Reload bypassed data cache')
  await page.$eval('a.repo', (node) =>
    node.setAttribute('href', 'https://github.com/openai/empty'),
  )
  await until(
    async () => (await badges()).includes('Stars: 0'),
    'recycled node rebind and real zero',
  )
  assert(
    (await badges()).includes('Stars: 42'),
    'Recycled node changed unrelated badge',
  )
  assert(
    dataCalls.length === 2,
    'Recycled node did not fetch exactly one new entity',
  )
  await page.$eval('a.repo', (node) =>
    node.setAttribute('href', 'https://github.com/openai/delayed'),
  )
  await until(() => Boolean(releaseData), 'delayed entity request')
  await page.$eval('a.repo', (node) =>
    node.setAttribute('href', 'https://github.com/openai/codex'),
  )
  await until(
    async () =>
      (await badges()).filter((text) => text === 'Stars: 42').length === 2,
    'fresh entity replaces pending entity',
  )
  releaseData?.()
  await Bun.sleep(200)
  assert(
    !(await badges()).includes('Stars: 99'),
    'Late data applied to a recycled node',
  )
  await page.evaluate(() => {
    const base = document.createElement('base')
    base.href = 'https://github.com/'
    document.head.append(base)
    document.querySelector('a.repo')?.setAttribute('href', '/openai/codex')
  })
  await until(
    async () =>
      (await badges()).filter((text) => text === 'Stars: 42').length === 2,
    'resolved relative repository link',
  )
  await page.$eval('base', (node) =>
    node.setAttribute('href', 'https://example.invalid/'),
  )
  await until(
    async () =>
      (await badges()).includes('Stars: no supported repository link'),
    'base URL change invalidates the entity',
  )
  await mutate('disable', { id: dataTarget.id })
  await until(async () => (await badges()).length === 0, 'data disable cleanup')
  assert(modelCalls === beforeDataModels, 'Data lifecycle invoked a model')
  console.log('Testing production library UI')
  await ui.bringToFront()
  await ui.waitForSelector('button[aria-label="Refresh Layers"]')
  await ui.click('button[aria-label="Refresh Layers"]')
  await ui.waitForFunction(() =>
    document.body.textContent?.includes('Repository stars'),
  )
  await ui.click('button[aria-label="Enable Repository stars"]')
  await until(() => store.read(dataTarget.id).enabled, 'UI re-enable')
  await ui.waitForSelector(
    'button[aria-label="Disable Repository stars"]:not([disabled])',
  )
  await ui.click('button[aria-label="Disable Repository stars"]')
  await until(() => !store.read(dataTarget.id).enabled, 'UI disable')
  // Exercise disclosure controls via real user input, not direct state mutation.
  const summaries = await ui.$$('summary')
  for (const summary of summaries)
    if (
      (await summary.evaluate((node) => node.textContent)) === 'Recent activity'
    )
      await summary.click()
  await ui.waitForFunction(() =>
    document.body.textContent?.includes('github.repository.stats'),
  )
  assert(
    store
      .activity()
      .some(
        (run) =>
          run.status === 'completed' &&
          run.provider === 'github.repository.stats',
      ),
    'Data activity missing',
  )
  if (testScripts) {
    console.log('Managed checks passed; testing complete script authoring flow')
    await until(
      () => broker.capabilities(profileId, 'fixture-provider').javascript,
      'script capability',
    )
    const source = `(() => {
      const button = document.createElement('button');
      button.id = 'script-translate'; button.textContent = 'Script translate';
      paneLayer.own(button); document.body.append(button);
      const output = document.createElement('p'); output.id = 'script-output';
      paneLayer.own(output); document.body.append(output);
      paneLayer.listen(button, 'click', () => {
        paneLayer.request('translate', {targetLanguage:'en', blocks:[{blockId:'article',text:document.querySelector('article p').textContent}]})
          .then(result => {output.textContent = result.blocks[0].translatedText;})
          .catch(error => {output.textContent = 'Rejected: ' + error.message;});
      });
    })();`
    const saved = await author('layer_draft', {
      revision: store.revision(),
      definition: {
        protocol: 'pane.layers.v1',
        name: 'Script translation',
        intent: 'Translate bounded article text on click',
        mode: 'javascript',
        scope: { origin, paths: ['/articles/*'] },
        operations: [],
        source,
        actions: translationLayer.definition.actions,
        assertions: [
          { id: 'button', selector: '#script-translate', state: 'visible' },
          {
            id: 'translated',
            selector: '#script-output',
            state: 'visible',
            textIncludes: 'English fixture:',
            afterAction: 'translate',
          },
        ],
      },
    })
    assert(saved.saved, `Script draft failed: ${JSON.stringify(saved)}`)
    const script = { id: saved.record.id, version: saved.record.latestVersion }
    console.log('Script test: previewing source')
    await author('layer_disable', { id: script.id, revision: store.revision() })

    const preview = await author('layer_preview', {
      ...script,
      tabId: target().tabId,
    })
    assert(
      preview.preview?.version === script.version,
      `Script preview failed: ${JSON.stringify(preview)}`,
    )
    assert(
      !store.read(script.id).enabled && !store.read(script.id).activeVersion,
      'Disabled script draft preview installed itself',
    )
    await page.waitForSelector('#script-translate')
    console.log('Script test: rejecting synthetic click')
    const before = modelCalls
    await page.evaluate(() =>
      (
        document.querySelector('#script-translate') as HTMLButtonElement
      ).click(),
    )
    await page.waitForFunction(() =>
      document
        .querySelector('#script-output')
        ?.textContent?.startsWith('Rejected:'),
    )
    assert(modelCalls === before, 'Synthetic script click reached model')
    await page.bringToFront()
    console.log('Script test: trusted translation click')
    await page.click('#script-translate')
    await page.waitForFunction(() =>
      document
        .querySelector('#script-output')
        ?.textContent?.includes('English fixture:'),
    )
    assert(
      modelCalls === before + 1,
      'Script action did not use exactly one private model call',
    )
    scriptChecks.push(
      'script trusted-click typed action bridge and synthetic rejection',
    )
    console.log('Script test: checking verification')
    const rendered = await page.$eval(
      '#script-output',
      (node) => node.textContent,
    )
    await page.$eval('#script-output', (node) => {
      node.textContent = 'wrong result'
    })
    const failedProof = await author('layer_verify', {
      ...script,
      tabId: target().tabId,
    })
    assert(
      !failedProof.passed && !failedProof.receiptId,
      'Incorrect script DOM result received a verification receipt',
    )
    await page.$eval(
      '#script-output',
      (node, text) => {
        node.textContent = text
      },
      rendered,
    )
    scriptChecks.push('incorrect script DOM result cannot activate a Layer')
    const proof = await author('layer_verify', {
      ...script,
      tabId: target().tabId,
    })
    assert(
      proof.passed &&
        proof.checks.reloaded &&
        !proof.checks.restored &&
        proof.checks.recovery === 'reload-required',
      `Script verification failed: ${JSON.stringify(proof)}`,
    )
    assert(
      modelCalls === before + 1,
      'Reload verification automatically invoked model',
    )
    scriptChecks.push(
      'script DOM assertions and temporary reload verification without model calls',
    )
    assert(
      proof.kept && proof.enabled,
      'Script verification did not enable the Layer',
    )
    await page.reload()
    await page.waitForSelector('#script-translate')
    assert(modelCalls === before + 1, 'Persistent script mount invoked model')
    assert(
      (await page.$eval('#draft', (el) => (el as HTMLInputElement).value)) ===
        'unsaved draft',
      'Script modified form',
    )
    scriptChecks.push('script automatic save and reload persistence')
    console.log(
      'Script test: clicking immediately after background worker loss',
    )
    const scriptWorkerTarget = await browser.waitForTarget(
      (candidate) => candidate.type() === 'service_worker',
    )
    const scriptWorker = await scriptWorkerTarget.worker()
    assert(scriptWorker, 'Missing script worker')
    await scriptWorker!.close()
    const beforeRecovery = modelCalls
    await page.bringToFront()
    await page.click('#script-translate')
    await until(
      () =>
        page.$eval(
          '#script-output',
          (node) => node.textContent?.includes('English fixture:') ?? false,
        ),
      'script action recovery before the 15-second document heartbeat',
      10_000,
    )
    assert(
      modelCalls === beforeRecovery + 1,
      'Recovered script action did not invoke the model exactly once',
    )
    scriptChecks.push(
      'script action recovers page identity immediately after service-worker loss',
    )
    console.log(
      'Script test: previewing a new version of an already active Layer',
    )
    const otherScriptTab = await browser.newPage()
    await otherScriptTab.goto(`${origin}/articles/other-version-tab`)
    await otherScriptTab.waitForSelector('#script-translate')
    await page.bringToFront()
    const draftVersion = await author('layer_draft', {
      id: script.id,
      revision: store.revision(),
      definition: {
        ...store.version(script.id, script.version).definition,
        name: 'Preview revised translation UI',
        source: `(() => { const panel = document.createElement('p'); panel.id='script-revision-preview'; panel.textContent='Revised panel'; document.body.append(paneLayer.own(panel)); })();`,
        actions: [],
        assertions: [
          {
            id: 'revised',
            selector: '#script-revision-preview',
            state: 'visible',
          },
        ],
      },
    })
    assert(draftVersion.saved, 'Existing-layer draft did not save')
    await author('layer_preview', {
      id: script.id,
      version: draftVersion.record.latestVersion,
      tabId: target().tabId,
    })
    await page.waitForSelector('#script-revision-preview')
    assert(
      !(await page.$('#script-translate')),
      'Active panel was not cleaned up before draft preview',
    )
    assert(
      Boolean(await otherScriptTab.$('#script-translate')),
      'Draft preview stopped active source in another tab',
    )
    assert(
      store.read(script.id).activeVersion === script.version,
      'Preview replaced the saved active version',
    )
    const versionState = await author('layer_list', {})
    assert(
      versionState.scripts.some(
        (state: any) =>
          state.tabId === target().tabId &&
          state.version === draftVersion.record.latestVersion &&
          state.status === 'executed',
      ),
      'Draft version was not reported as executed',
    )
    const secondDraft = await author('layer_draft', {
      id: script.id,
      revision: store.revision(),
      definition: {
        ...store.version(script.id, draftVersion.record.latestVersion)
          .definition,
        source: `(() => { const panel = document.createElement('p'); panel.id='script-revision-preview'; panel.textContent='Revised again'; document.body.append(paneLayer.own(panel)); })();`,
      },
    })
    await author('layer_preview', {
      id: script.id,
      version: secondDraft.record.latestVersion,
      tabId: target().tabId,
    })
    await page.waitForFunction(
      () =>
        document.querySelector('#script-revision-preview')?.textContent ===
        'Revised again',
    )
    assert(
      (await page.$$eval(
        '#script-revision-preview',
        (nodes) => nodes.length,
      )) === 1,
      'Previous preview panel was left mounted',
    )
    await author('layer_clear_preview', { tabId: target().tabId })
    await until(
      async () => !(await page.$('#script-revision-preview')),
      'rejected draft cleanup',
    )
    await otherScriptTab.close()
    await page.reload()
    await page.waitForSelector('#script-translate')
    await author('layer_tabs', {})
    scriptChecks.push(
      'existing-layer draft replaces only its target document; clearing and reloading restores active version',
    )
    const disabled = await mutate('disable', { id: script.id })
    assert(disabled.ok, `Script disable failed: ${JSON.stringify(disabled)}`)
    await until(
      async () => !(await page.$('#script-translate')),
      'script cleanup',
    )
    const warmEnable = await author('layer_enable', {
      id: script.id,
      revision: store.revision(),
    })
    assert(
      warmEnable.enabled &&
        warmEnable.scripts.some(
          (state: any) =>
            state.layerId === script.id && state.status === 'reload-required',
        ),
      'Agent did not receive script reload-required state',
    )
    let reloadError = ''
    try {
      await author('layer_preview', { ...script, tabId: target().tabId })
    } catch (error) {
      reloadError = String(error)
    }
    assert(
      reloadError.includes('Reload'),
      `Warm script preview did not request reload: ${reloadError}`,
    )
    await author('layer_disable', { id: script.id, revision: store.revision() })
    const disabledDocumentId = target().documentId
    await page.reload()
    await page.waitForSelector('article')
    assert(!(await page.$('#script-translate')), 'Disabled script reapplied')
    scriptChecks.push('script disable cleanup and future injection revocation')
    console.log('Script test: UI disable followed by agent enable and preview')
    await until(
      () =>
        broker
          .documents(profileId)
          .some(
            (doc) =>
              doc.url === page.url() && doc.documentId !== disabledDocumentId,
          ),
      'script document after disabled reload',
    )
    const scriptState = await author('layer_list', {})
    assert(
      scriptState.records.find((record: any) => record.id === script.id)
        ?.status === 'disabled',
      'Agent did not see disabled script',
    )
    let previewError = ''
    try {
      await author('layer_preview', { ...script, tabId: target().tabId })
    } catch (error) {
      previewError = String(error)
    }
    assert(
      previewError.includes('layer_enable'),
      `Disabled preview lacked recovery instructions: ${previewError}`,
    )
    const scriptEnabled = await author('layer_enable', {
      id: script.id,
      revision: store.revision(),
    })
    assert(
      scriptEnabled.enabled && !scriptEnabled.record.disabledLocally,
      'Agent script enable left browser disabled',
    )
    const retried = await author('layer_preview', {
      ...script,
      tabId: target().tabId,
    })
    assert(
      retried.preview?.version === script.version,
      'Preview failed after agent enable',
    )
    await page.waitForSelector('#script-translate')
    const scriptUi = await mutate('state')
    assert(
      !scriptUi.local.disabledIds.includes(script.id),
      'Script UI still showed disabled',
    )
    await author('layer_disable', { id: script.id, revision: store.revision() })
    await until(
      async () => !(await page.$('#script-translate')),
      'agent script disable cleanup',
    )
    await page.reload()
    scriptChecks.push(
      'agent observes browser disable, enables it, and previews successfully',
    )

    const savedData = await author('layer_draft', {
      revision: store.revision(),
      definition: {
        protocol: 'pane.layers.v1',
        name: 'Script data',
        intent: 'Show public repository stars on load',
        mode: 'javascript',
        scope: { origin, paths: ['/articles/*'] },
        operations: [],
        actions: store.version(data.record.id, data.record.latestVersion)
          .definition.actions,
        source: `(() => {
        const badge = document.createElement('p'); badge.id = 'script-data'; badge.textContent = 'Loading';
        paneLayer.own(badge); document.body.append(badge);
        paneLayer.request('counts',{schema:'pane.data-input.v1',operationId:'github.repository.stats',entities:['openai/codex']})
          .then(result => {badge.textContent = String(result.entries[0].values.stars);})
          .catch(error => {badge.textContent = 'Failed: '+error.message;});
      })();`,
        assertions: [
          {
            id: 'badge',
            selector: '#script-data',
            state: 'visible',
            textIncludes: '42',
          },
          {
            id: 'value',
            selector: '#script-data',
            state: 'visible',
            textIncludes: '42',
            afterAction: 'counts',
          },
        ],
      },
    })
    assert(
      savedData.saved,
      `Data script draft failed: ${JSON.stringify(savedData)}`,
    )
    const dataScript = {
      id: savedData.record.id,
      version: savedData.record.latestVersion,
    }
    await until(
      () => broker.documents(profileId).some((doc) => doc.url === page.url()),
      'data script document',
    )
    await author('layer_preview', { ...dataScript, tabId: target().tabId })
    await page.waitForFunction(
      () => document.querySelector('#script-data')?.textContent === '42',
    )
    const dataProof = await author('layer_verify', {
      ...dataScript,
      tabId: target().tabId,
    })
    assert(
      dataProof.passed && dataProof.checks.reloaded,
      `Data script reload failed: ${JSON.stringify(dataProof)}`,
    )
    assert(modelCalls === beforeRecovery + 1, 'Data script invoked model')
    scriptChecks.push(
      'script document-load data action works during preview and temporary reload',
    )
    await author('layer_disable', {
      id: dataScript.id,
      revision: store.revision(),
    })
    await author('layer_clear_preview', { tabId: target().tabId })
    await until(
      async () => !(await page.$('#script-data')),
      'data preview cleanup',
    )
    console.log('Testing generated page scripts through an actual saved button')
    const generated = await author('layer_draft', {
      revision: store.revision(),
      definition: {
        protocol: 'pane.layers.v1',
        name: 'Adapt page',
        intent: 'Add a useful custom view on demand',
        mode: 'javascript',
        scope: { origin, paths: ['/articles/*'] },
        operations: [],
        source: `(() => {const button=document.createElement('button');button.id='generated-button';button.textContent='Adapt page';document.body.append(paneLayer.own(button));paneLayer.listen(button,'click',()=>{button.dataset.status='running';paneLayer.request('adapt',button.dataset.invalid==='true'?{schema:'pane.script-task-input.v1',briefSelector:'#brief',briefBytes:42}:{schema:'pane.script-task-input.v1'}).then(result=>{button.dataset.status='done';button.dataset.executions=String(result.executions.length);}).catch(error=>{button.dataset.status='failed';button.textContent=error.message;});});})();`,
        actions: [
          {
            id: 'adapt',
            kind: 'page-task',
            execution: 'javascript',
            trigger: 'click',
            instruction:
              'Add a visible custom paragraph saying Adapted by agent; verify and repair if needed.',
            outputSchema: 'pane.script-task-receipt.v1',
            providerId: 'unverified-provider',
            limits: { maxSteps: 8, maxOutputTokens: 8192, deadlineMs: 30000 },
          },
        ],
        assertions: [
          { id: 'button', selector: '#generated-button', state: 'visible' },
          {
            id: 'output',
            selector: '#generated-result',
            state: 'visible',
            textIncludes: 'Adapted by agent',
            afterAction: 'adapt',
          },
        ],
      },
    })
    assert(
      generated.saved,
      `Generated task draft failed: ${JSON.stringify(generated)}`,
    )
    const generatedLayer = {
      id: generated.record.id,
      version: generated.record.latestVersion,
    }
    await author('layer_preview', { ...generatedLayer, tabId: target().tabId })
    await page.waitForSelector('#generated-button')
    const generatedModels = modelCalls
    assert(
      broker.capabilities(profileId, 'unverified-provider').provider ===
        'unverified',
      'Generated provider was already verified',
    )
    await page.$eval('#generated-button', (node) => {
      ;(node as HTMLElement).dataset.invalid = 'true'
    })
    await page.bringToFront()
    await page.click('#generated-button')
    await page.waitForSelector('#generated-button[data-status="failed"]')
    assert(
      (
        await page.$eval('#generated-button', (node) => node.textContent)
      )?.includes('Invalid generated-script action input'),
      'Unsupported brief payload did not report an input-contract error',
    )
    assert(
      modelCalls === generatedModels,
      'Invalid brief payload reached the provider',
    )
    await page.$eval('#generated-button', (node) => {
      delete (node as HTMLElement).dataset.invalid
    })
    await page.bringToFront()
    await page.click('#generated-button')
    await page.waitForSelector('#generated-button[data-status="done"]', {
      timeout: 20000,
    })
    assert(
      (await page.$eval('#generated-button', (node) =>
        node.getAttribute('data-executions'),
      )) === '2',
      'Generated page loop did not repair its first failed attempt',
    )
    assert(
      (await page.$eval('#generated-result', (node) => node.textContent)) ===
        'Adapted by agent',
      'Generated script result was not actually rendered',
    )
    assert(
      modelCalls === generatedModels + generatedRequestCount,
      'Generated task did not use the inspect/execute/inspect/execute/complete loop',
    )
    assert(
      broker.capabilities(profileId, 'unverified-provider').provider ===
        'ready',
      'Successful generated action did not verify its provider',
    )
    scriptChecks.push(
      'unverified provider runs generated-script action; unsupported brief fields fail before any model call',
    )
    const generatedProof = await author('layer_verify', {
      ...generatedLayer,
      tabId: target().tabId,
    })
    assert(
      generatedProof.passed,
      `Generated script verification failed: ${JSON.stringify(generatedProof)}`,
    )
    assert(
      generatedProof.kept && generatedProof.enabled,
      'Generated verification did not enable the Layer',
    )
    const beforeGeneratedReload = modelCalls
    await page.reload()
    await page.waitForSelector('#generated-button')
    assert(
      modelCalls === beforeGeneratedReload,
      'Reload automatically invoked generated model work',
    )
    await page.bringToFront()
    await page.click('#generated-button')
    await page.waitForSelector('#generated-button[data-status="done"]', {
      timeout: 20000,
    })
    assert(
      modelCalls === beforeGeneratedReload + generatedRequestCount,
      'Saved generated action did not rebind to new document',
    )
    assert(
      (await page.$eval(
        '#draft',
        (node) => (node as HTMLInputElement).value,
      )) === 'unsaved draft',
      'Generated task modified form contents',
    )
    if (testClaude) {
      console.log(
        'Testing persisted Claude failure diagnostics in the production UI',
      )
      await page.reload()
      await page.waitForSelector('#generated-button')
      denyClaudeAccount = true
      await page.bringToFront()
      await page.click('#generated-button')
      await page.waitForSelector('#generated-button[data-status="failed"]', {
        timeout: 20000,
      })
      denyClaudeAccount = false
      const failed = store
        .activity()
        .find(
          (run) => run.layerId === generatedLayer.id && run.status === 'failed',
        )
      assert(
        failed?.failureCode === 'PROVIDER_ACCESS_DENIED',
        'Runner reason was not persisted',
      )
      await ui.bringToFront()
      await ui.click('button[aria-label="Refresh Layers"]')
      await ui.waitForFunction(() =>
        document.body.textContent?.includes(
          'Your organization has disabled Claude subscription access',
        ),
      )
      const disclosure = await ui.$$('summary')
      for (const summary of disclosure)
        if (
          (await summary.evaluate((node) => node.textContent)) ===
            'Recent activity' &&
          !(await summary.evaluate((node) =>
            node.parentElement?.hasAttribute('open'),
          ))
        )
          await summary.click()
      assert(
        await ui.evaluate(() =>
          Array.from(document.querySelectorAll('p')).some(
            (node) =>
              node.textContent?.includes(
                'Your organization has disabled Claude subscription access',
              ) && node.getBoundingClientRect().height > 0,
          ),
        ),
        'Failure reason is not visible in Recent activity',
      )
      scriptChecks.push(
        'Claude Settings alias completes private page loop; provider failures have visible persisted diagnostics',
      )
    }
    assert(
      (await mutate('disable', { id: generatedLayer.id })).ok,
      'Generated task disable failed',
    )
    scriptChecks.push(
      'saved generated button rebinds after reload without automatic inference and preserves forms',
    )
    await author('layer_clear_preview', { tabId: target().tabId })
    await until(
      async () => !(await page.$('#generated-result')),
      'generated script cleanup',
    )
    scriptChecks.push(
      'trusted button uses private inspect-execute-check-repair tools for generated scripts',
    )
    scriptChecks.push(
      'generated execution receipts support verification and tracked cleanup',
    )
    console.log(
      'Testing native recovery from a deliberately hung disposable page',
    )
    const hung = await author('layer_draft', {
      revision: store.revision(),
      definition: {
        protocol: 'pane.layers.v1',
        name: 'Hung script fixture',
        intent: 'Disposable infinite-loop recovery test',
        mode: 'javascript',
        scope: { origin, paths: ['/articles/*'] },
        operations: [],
        actions: [],
        source: 'while (true) {}',
        assertions: [{ id: 'body', selector: 'body', state: 'present' }],
      },
    })
    assert(hung.saved, 'Hung fixture draft failed')
    const hungScript = {
      id: hung.record.id,
      version: hung.record.latestVersion,
    }
    let timedOut = false
    const startedAt = Date.now()
    try {
      await author('layer_preview', { ...hungScript, tabId: target().tabId })
    } catch {
      timedOut = true
    }
    assert(
      timedOut &&
        Date.now() - startedAt >= 4500 &&
        Date.now() - startedAt < 15000,
      'Hung script did not fail within its initialization deadline',
    )
    const initializationMs = Date.now() - startedAt
    const pausedAt = Date.now()
    const pause = await mutate('pause', { paused: true })
    assert(
      pause.ok && Date.now() - pausedAt < 3000,
      'Layers controls blocked behind a hung page renderer',
    )
    recoveryTiming = { initializationMs, pauseMs: Date.now() - pausedAt }
    await page.close()
    scriptChecks.push(
      'infinite-loop script times out while trusted pause controls remain responsive',
    )
  }

  const accessibilityName = 'طبقة'.repeat(25)
  store.draft(
    {
      protocol: 'pane.layers.v1',
      name: accessibilityName,
      intent: 'Check long names, keyboard access and readable narrow layouts.',
      mode: 'managed',
      scope: { origin, paths: [`/accessibility/${'a'.repeat(220)}`] },
      operations: [
        {
          id: 'highlight',
          kind: 'highlight',
          anchor: { selector: '#recommendations' },
        },
      ],
    },
    store.revision(),
  )
  await ui.click('[aria-label="Refresh Layers"]')
  await ui.waitForFunction(
    (name) =>
      [...document.querySelectorAll('article h2')].some(
        (heading) => heading.textContent === name,
      ),
    {},
    accessibilityName,
  )
  const accessibility = await checkLayersAccessibility(ui, accessibilityName)
  await ui.screenshot({ path: '/tmp/pane-layers-library.png', fullPage: true })

  console.log(
    JSON.stringify(
      {
        browser: await browser.version(),
        userScriptsAvailable: broker.capabilities(profileId).javascript,
        passed: [
          'production background/content connection',
          'verified automatic activation',
          'mount-cleanup verification',
          'automatic reload verification in a temporary tab',
          'reload persistence without model work',
          'form preservation',
          'enable-disable',
          'managed BFCache remount preserves the original form',
          'cached disabled Layers are not briefly reapplied during restoration',
          'SPA exclusion',
          'revisit',
          'synthetic click rejection',
          'real trusted-click private provider tool call',
          'typed rendering',
          'original preservation',
          'translation undo',
          'cancellation',
          'adaptive opaque-handle page action',
          'adaptive actual application verification',
          'adaptive undo and form preservation',
          'adaptive stale-plan rejection',
          'registered data batching without model work',
          'data duplicate coalescing and reload cache',
          'data action verification and persistence',
          'virtualized entity rebinding and real zero',
          'data disable cleanup',
          'late data rejected after entity replacement',
          'relative link base changes invalidate data identity',
          'production library enable-disable controls',
          'durable activity disclosure',
          'library Stop cancels provider work',
          'minimal Layer controls',
          ...scriptChecks,
          ...accessibility.passed,
        ],
        nativeCredentialDelivery:
          'fixture injection; native launch not tested here',
        provider: testCodex
          ? 'installed Codex CLI with local deterministic API'
          : testClaude
            ? 'installed Claude CLI with local deterministic API'
            : 'local deterministic API fixture',
        claudeInitModels: [...claudeInitModels],
        recoveryTiming,
        accessibility: {
          layouts: accessibility.layouts,
          namedControls: accessibility.namedControls,
        },
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error('Integration probe failed:', error)
  throw error
} finally {
  clearTimeout(watchdog)
  delayed?.()
  releaseData?.()
  await browser?.close()
  server.stop(true)
  db.close()
  await rm(dir, { recursive: true, force: true })
}
