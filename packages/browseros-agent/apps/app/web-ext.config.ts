import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineWebExtConfig } from 'wxt'

const configDir = dirname(fileURLToPath(import.meta.url))

// biome-ignore lint/style/noProcessEnv: config file needs env access
const env = process.env
const legacySharedProfiles = new Set([
  '/tmp/browseros-dev',
  '/private/tmp/browseros-dev',
])

const paneDevCandidates = [
  env.CHROMIUM_OUT
    ? join(env.CHROMIUM_OUT, 'Pane Dev.app/Contents/MacOS/Pane Dev')
    : '',
  join(
    env.HOME ?? '',
    'chromium/src/out/Default_arm64/Pane Dev.app/Contents/MacOS/Pane Dev',
  ),
  join(
    env.HOME ?? '',
    'chromium/src/out/Default/Pane Dev.app/Contents/MacOS/Pane Dev',
  ),
].filter(Boolean)

/** Pane Dev binary for WXT; override with PANE_BINARY or BROWSEROS_BINARY. */
function resolvePaneBinary(): string {
  for (const key of ['PANE_BINARY', 'BROWSEROS_BINARY'] as const) {
    const value = env[key]?.trim()
    if (value) {
      return value
    }
  }
  for (const candidate of paneDevCandidates) {
    if (candidate && existsSync(candidate)) {
      return candidate
    }
  }
  return join(
    env.HOME ?? '',
    'chromium/src/out/Default_arm64/Pane Dev.app/Contents/MacOS/Pane Dev',
  )
}

/** Returns a worktree-scoped Chromium profile for this checkout. */
function defaultChromiumProfile(): string {
  const agentRoot = resolve(configDir, '../..')
  const worktreeRoot = resolve(agentRoot, '../..')
  const label = sanitizeProfileLabel(basename(worktreeRoot)) || 'repo'
  const key = createHash('sha256').update(agentRoot).digest('hex').slice(0, 8)
  return join(tmpdir(), `browseros-dev-${label}-${key}`)
}

function sanitizeProfileLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Honors explicit profiles but upgrades the old shared temp profile. */
function chromiumProfile(): string {
  const configured = env.BROWSEROS_USER_DATA_DIR?.trim()
  let profile: string
  if (configured && !legacySharedProfiles.has(resolve(configured))) {
    profile = configured
  } else {
    profile = defaultChromiumProfile()
  }
  mkdirSync(profile, { recursive: true })
  return profile
}

const chromiumArgs = [
  '--use-mock-keychain',
  '--show-component-extension-options',
  '--disable-browseros-server',
  '--disable-browseros-extensions',
  '--browseros-dock-icon=dev',
]

if (env.BROWSEROS_CDP_PORT) {
  chromiumArgs.push(`--remote-debugging-port=${env.BROWSEROS_CDP_PORT}`)
}
if (env.BROWSEROS_SERVER_PORT) {
  chromiumArgs.push(`--browseros-mcp-port=${env.BROWSEROS_SERVER_PORT}`)
  chromiumArgs.push(`--browseros-server-port=${env.BROWSEROS_SERVER_PORT}`)
  chromiumArgs.push(`--browseros-proxy-port=${env.BROWSEROS_SERVER_PORT}`)
}
if (env.BROWSEROS_EXTENSION_PORT) {
  chromiumArgs.push(
    `--browseros-extension-port=${env.BROWSEROS_EXTENSION_PORT}`,
  )
}

export default defineWebExtConfig({
  binaries: {
    chrome: resolvePaneBinary(),
  },
  chromiumArgs,
  chromiumProfile: chromiumProfile(),
  keepProfileChanges: true,
  startUrls: ['chrome://newtab'],
})
