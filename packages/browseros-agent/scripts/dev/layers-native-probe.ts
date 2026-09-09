/** Native launch-pipe and extension-identity test in a disposable profile.
 * Uses production Layer authentication/routes with a small fixture sidecar. */
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer, { type Browser } from 'puppeteer-core'
import { checkProductionScriptRegistry } from './layers-registry-checks'
import { checkUserScriptWorlds } from './layers-userscript-checks'

const root = resolve(import.meta.dir, '../..')
const uiProbe = process.argv.includes('--ui')
const scriptsProbe = process.argv.includes('--scripts')
const scriptChecks = new Set<string>()
const dir = await mkdtemp(join(tmpdir(), 'pane-layers-native-'))
let browser: Browser | undefined
let diagnostics = ''
const resourceDir = join(dir, 'resources')
await mkdir(join(resourceDir, 'bin'), { recursive: true })
const fixturePath = join(dir, 'sidecar.ts')
const serverSource = join(root, 'apps/server/src')
await writeFile(
  fixturePath,
  `
import { Database } from 'bun:sqlite';
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(join(dir, 'sidecar.pid'))}, String(process.pid) + String.fromCharCode(10));
import { layerAuthority } from ${JSON.stringify(join(serverSource, 'layers/broker-auth.ts'))};
import { createLayerRoutes } from ${JSON.stringify(join(serverSource, 'layers/routes.ts'))};
import { LayerStore } from ${JSON.stringify(join(serverSource, 'layers/store.ts'))};
import { LAYERS_SCHEMA_SQL } from ${JSON.stringify(join(serverSource, 'lib/db/schema/layers.ts'))};
import { LAYER_ACTIVITY_SCHEMA_SQL } from ${JSON.stringify(join(serverSource, 'lib/db/schema/layer-activity.ts'))};
if (!layerAuthority || process.env.PANE_LAYERS_BOOTSTRAP_FD) throw new Error('Native pipe bootstrap failed');
const portArg = process.argv.find(arg => arg.startsWith('--server-port='));
const port = Number(portArg?.split('=')[1]);
if (!port) throw new Error('Native server port missing');
const db = new Database(':memory:'); db.exec(LAYERS_SCHEMA_SQL + LAYER_ACTIVITY_SCHEMA_SQL);
const routes = createLayerRoutes({ authority: layerAuthority, store: () => new LayerStore(db) });
Bun.serve({ hostname:'127.0.0.1', port, fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/health') return Response.json({ status:'ok' });
  if (url.pathname === '/registry' || url.pathname === '/registry-away') return new Response('<!doctype html><title>Layer lifecycle fixture</title><main><h1>Lifecycle</h1><input id="preserved-form" aria-label="Draft"></main>', {headers:{'content-type':'text/html'}});
  if (!url.pathname.startsWith('/layers/')) return new Response('Missing', {status:404});
  url.pathname = url.pathname.slice('/layers'.length);
  return routes.fetch(new Request(url,request));
}});
`,
)
const build = Bun.spawn(
  [
    process.execPath,
    'build',
    '--compile',
    '--define',
    'process.env.NODE_ENV="production"',
    fixturePath,
    '--outfile',
    join(resourceDir, 'bin/browseros_server'),
  ],
  { cwd: root, stdout: 'pipe', stderr: 'pipe' },
)
if ((await build.exited) !== 0)
  throw new Error(await new Response(build.stderr).text())
const extension = join(dir, 'extension')
await mkdir(extension)
const config = await readFile(join(root, 'apps/app/wxt.config.ts'), 'utf8')
const key = /key: '([^']+)'/.exec(config)?.[1]
if (!key) throw new Error('Bundled key missing')
await writeFile(
  join(extension, 'manifest.json'),
  JSON.stringify({
    manifest_version: 3,
    name: 'Layers native probe',
    version: '1.0',
    key,
    permissions: [
      'browserOS',
      'storage',
      'tabs',
      'sidePanel',
      'userScripts',
      'scripting',
      'webNavigation',
    ],
    host_permissions: ['http://127.0.0.1/*'],
    background: { service_worker: 'background.js' },
  }),
)
await writeFile(
  join(extension, 'background.js'),
  'chrome.runtime.onMessage.addListener((m,s,r)=>{r({ready:true})});',
)
if (scriptsProbe) {
  const entry = join(dir, 'registry-background.ts')
  await writeFile(
    entry,
    `import { LayerUserScriptRegistry } from ${JSON.stringify(join(root, 'apps/app/entrypoints/background/layers/user-script-registry.ts'))};
    import { layerVersionDigest } from ${JSON.stringify(join(root, 'packages/shared/src/layers/digest.ts'))};
    globalThis.scriptDefinitionDigest = layerVersionDigest;
    globalThis.createScriptRegistry = (options) => new LayerUserScriptRegistry(options);
    chrome.runtime.onMessage.addListener((m,s,r)=>{r({ready:true})});`,
  )
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: extension,
    naming: 'background.js',
    target: 'browser',
    format: 'iife',
  })
  if (!result.success) throw new Error(result.logs.map(String).join('\n'))
}
if (uiProbe) {
  const built = join(root, 'apps/app/dist/chrome-mv3-dev')
  for (const file of ['layers.html', 'chunks', 'assets', 'geist', 'geist-mono'])
    await cp(join(built, file), join(extension, file), { recursive: true })
  const entry = join(dir, 'native-background.ts')
  await writeFile(
    entry,
    `import {layersBridge} from ${JSON.stringify(join(root, 'apps/app/entrypoints/background/layers.ts'))}; layersBridge();`,
  )
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: extension,
    naming: 'background.js',
    target: 'browser',
    format: 'iife',
    define: { 'import.meta.env': '{}' },
    plugins: [
      {
        name: 'app-alias',
        setup(build) {
          build.onResolve({ filter: /^@\// }, ({ path }) =>
            path === '@/lib/llm-providers/storage'
              ? { path, namespace: 'fixture-provider' }
              : {
                  path: Bun.resolveSync(
                    join(root, 'apps/app', path.slice(2)),
                    root,
                  ),
                },
          )
          build.onLoad({ filter: /.*/, namespace: 'fixture-provider' }, () => ({
            contents: 'export const loadProviders = async () => [];',
            loader: 'ts',
          }))
        },
      },
    ],
  })
  if (!result.success) throw new Error(result.logs.map(String).join('\n'))
}
const watchdog = setTimeout(
  () => browser?.process()?.kill('SIGKILL'),
  uiProbe ? 240000 : scriptsProbe ? 120000 : 60000,
)
async function closeFixture() {
  const closing = browser?.close()
  // Native health recovery can race browser shutdown; record and terminate
  // every fixture child, not just whichever PID last wrote the file.
  for (let round = 0; round < 3; round++) {
    await Bun.sleep(500)
    try {
      const pids = (await readFile(join(dir, 'sidecar.pid'), 'utf8'))
        .trim()
        .split(/\s+/)
        .map(Number)
      for (const pid of pids) {
        if (Number.isSafeInteger(pid) && pid > 1) {
          try {
            process.kill(pid, 'SIGTERM')
          } catch {}
        }
      }
    } catch {}
  }
  await closing
  browser = undefined
}
try {
  let previousToken = ''
  let firstProfile = ''
  let version = ''
  for (let visit = 0; visit < (uiProbe ? 1 : scriptsProbe ? 3 : 2); visit++) {
    browser = await puppeteer.launch({
      executablePath:
        process.env.PANE_TEST_EXECUTABLE ??
        '/Users/abhishek/chromium/src/out/Default_arm64/Pane.app/Contents/MacOS/Pane',
      headless: !uiProbe,
      userDataDir: join(dir, 'profile'),
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--load-extension=${extension}`,
        `--disable-extensions-except=${extension}`,
        `--browseros-server-resources-dir=${resourceDir}`,
        '--disable-background-networking',
        '--no-first-run',
      ],
    })
    version = await browser.version()
    browser.process()?.stderr?.on('data', (chunk) => {
      diagnostics = (diagnostics + String(chunk)).slice(-10000)
    })
    const target = await browser.waitForTarget(
      (target) =>
        target.type() === 'service_worker' &&
        target.url().endsWith('/background.js'),
      { timeout: 20000 },
    )
    const worker = await target.worker()
    if (!worker) throw new Error('Native probe worker unavailable')
    let passed = false
    let lastError = ''
    for (let i = 0; i < 100; i++) {
      try {
        const config = JSON.parse(
          await readFile(
            join(dir, 'profile/.browseros/server_config.json'),
            'utf8',
          ),
        )
        const result = await worker.evaluate(
          async ({ port, previousToken }) => {
            const api = (
              chrome as unknown as {
                browserOS: {
                  getLayerCredential(
                    cb: (value: { profileId: string; token: string }) => void,
                  ): void
                }
              }
            ).browserOS
            const credential = await new Promise<{
              profileId: string
              token: string
            }>((resolve, reject) =>
              api.getLayerCredential((value) =>
                chrome.runtime.lastError
                  ? reject(new Error(chrome.runtime.lastError.message))
                  : resolve(value),
              ),
            )
            const response = await fetch(
              `http://127.0.0.1:${port}/layers/state`,
              { headers: { Authorization: `Bearer ${credential.token}` } },
            )
            const body = await response.json()
            const unsigned = await fetch(
              `http://127.0.0.1:${port}/layers/state`,
            )
            const previous = previousToken
              ? await fetch(`http://127.0.0.1:${port}/layers/state`, {
                  headers: { Authorization: `Bearer ${previousToken}` },
                })
              : undefined
            const encoded = credential.token.split('.')[4]
            const claims = JSON.parse(
              atob(encoded.replace(/-/g, '+').replace(/_/g, '/')),
            )
            return {
              credential,
              status: response.status,
              unsignedStatus: unsigned.status,
              previousRejected: !previous || previous.status === 401,
              profileMatches: body.profileId === credential.profileId,
              expiresIn: claims.expiresAt - Date.now(),
            }
          },
          { port: config.ports.server, previousToken },
        )
        // Credentials remain only in test process memory across the restart.
        // Never include them in diagnostics or the evidence output.
        const { credential, ...checks } = result
        if (
          checks.status !== 200 ||
          checks.unsignedStatus !== 401 ||
          !checks.previousRejected ||
          !checks.profileMatches ||
          checks.expiresIn <= 0 ||
          checks.expiresIn > 300000
        )
          throw new Error(`Native checks failed: ${JSON.stringify(checks)}`)
        if (firstProfile && firstProfile !== credential.profileId)
          throw new Error('Profile identity changed after browser restart')
        firstProfile = credential.profileId
        previousToken = credential.token
        passed = true
        break
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'unknown'
        await Bun.sleep(100)
      }
    }
    if (!passed)
      throw new Error(`Native authority validation failed: ${lastError}`)
    if (scriptsProbe && visit < 2) {
      const config = JSON.parse(
        await readFile(
          join(dir, 'profile/.browseros/server_config.json'),
          'utf8',
        ),
      )
      const checks = await checkUserScriptWorlds(
        browser,
        worker,
        `http://127.0.0.1:${config.ports.server}/health`,
        visit,
      )
      for (const check of checks) scriptChecks.add(check)
      for (const check of await checkProductionScriptRegistry(
        browser,
        worker,
        `http://127.0.0.1:${config.ports.server}/registry`,
      ))
        scriptChecks.add(check)
    }
    if (scriptsProbe && visit === 1) {
      const settings = await browser.newPage()
      try {
        await settings.goto('chrome://extensions')
        await settings.evaluate(async () => {
          await (chrome as any).developerPrivate.updateExtensionConfiguration({
            extensionId: 'biedncddmddkpapdplhcnkhhplnfgbif',
            userScriptsAccess: false,
          })
        })
      } finally {
        await settings.close()
      }
    }
    if (scriptsProbe && visit >= 1) {
      const disabled = await worker.evaluate(async () => {
        await new Promise<void>((resolve, reject) =>
          (chrome as any).browserOS.getLayerCredential(() => {
            if (chrome.runtime.lastError)
              reject(new Error(chrome.runtime.lastError.message))
            else resolve()
          }),
        )
        try {
          await chrome.userScripts.getScripts()
          return false
        } catch {
          return true
        }
      })
      if (!disabled)
        throw new Error(
          'Credential refresh overrode an explicit userscript opt-out.',
        )
      scriptChecks.add(
        visit === 1
          ? 'explicit native userscript opt-out survives credential refresh'
          : 'explicit native userscript opt-out survives browser restart',
      )
    }
    if (uiProbe) {
      const page = await browser.newPage()
      const config = JSON.parse(
        await readFile(
          join(dir, 'profile/.browseros/server_config.json'),
          'utf8',
        ),
      )
      await page.goto(`http://127.0.0.1:${config.ports.server}/health`)
      await page.bringToFront()
      const donePath = join(dir, 'ui-done')
      await writeFile(
        '/tmp/pane-layers-native-ui.json',
        JSON.stringify({ pid: browser.process()?.pid, donePath }),
      )
      console.log(`Native UI ready; completion file: ${donePath}`)
      let done = false
      for (let i = 0; i < 180; i++) {
        try {
          await access(donePath)
          done = true
          break
        } catch {}
        await Bun.sleep(1000)
      }
      if (!done) throw new Error('Native UI probe was not completed.')
    }
    await closeFixture()
  }
  console.log(
    JSON.stringify(
      {
        browser: version,
        passed: [
          'native inherited-pipe bootstrap',
          'descriptor consumed before provider launch',
          'bundled extension credential API',
          'native signature verified by production server',
          'profile-bound state',
          'unsigned request rejected',
          'five-minute credential expiry',
          ...scriptChecks,
          ...(!uiProbe
            ? [
                'browser restart preserves profile identity',
                'new launch rejects previous launch credentials',
              ]
            : []),
        ],
        sidecar: 'production authentication and routes in fixture launcher',
        ...(uiProbe
          ? {
              uiInteraction:
                'Externally checked through native UI automation; production popup and Layer transport, empty fixture provider list.',
            }
          : {}),
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(diagnostics)
  throw error
} finally {
  await closeFixture()
  clearTimeout(watchdog)
  await rm(dir, { recursive: true, force: true })
}
