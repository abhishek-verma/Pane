#!/usr/bin/env bun
/**
 * Generate or patch Chrome extension update manifests for Pane GitHub Releases.
 *
 * Usage:
 *   bun scripts/release/generate-extension-update-manifest.ts \
 *     --app-id biedncddmddkpapdplhcnkhhplnfgbif \
 *     --version 0.0.100 \
 *     --codebase "https://github.com/abhishek-verma/Pane/releases/download/agent-extension/v0.0.100/pane-agent-0.0.100-chrome.zip" \
 *     --output updates/extensions/update-manifest.xml
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const GUPDATE_NS = 'http://www.google.com/update2/response'

interface ExtensionEntry {
  appid: string
  version: string
  codebase: string
}

function parseArgs(argv: string[]): {
  appId: string
  version: string
  codebase: string
  output: string
  mergeFrom?: string
} {
  const values = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`)
    }
    values.set(key, next)
    i++
  }

  const appId = values.get('app-id')
  const version = values.get('version')
  const codebase = values.get('codebase')
  const output = values.get('output')
  if (!appId || !version || !codebase || !output) {
    throw new Error(
      'Required: --app-id, --version, --codebase, --output (optional: --merge-from)',
    )
  }

  return {
    appId,
    version,
    codebase,
    output,
    mergeFrom: values.get('merge-from'),
  }
}

function parseManifest(xml: string): ExtensionEntry[] {
  const entries: ExtensionEntry[] = []
  const appBlocks = xml.matchAll(
    /<app\b[^>]*appid="([^"]+)"[^>]*>[\s\S]*?<\/app>/g,
  )
  for (const match of appBlocks) {
    const block = match[0]
    const appid = match[1]
    const version = block.match(/<updatecheck\b[^>]*\bversion="([^"]+)"/)?.[1]
    const codebase = block.match(/<updatecheck\b[^>]*\bcodebase="([^"]+)"/)?.[1]
    if (appid && version && codebase) {
      entries.push({ appid, version, codebase })
    }
  }
  return entries
}

function renderManifest(entries: ExtensionEntry[]): string {
  const apps = entries
    .map(
      (entry) =>
        `  <app appid="${entry.appid}">\n    <updatecheck codebase="${entry.codebase}" version="${entry.version}"/>\n  </app>`,
    )
    .join('\n')

  return `<?xml version='1.0' encoding='UTF-8'?>\n<gupdate xmlns="${GUPDATE_NS}" protocol="2.0">\n${apps}\n</gupdate>\n`
}

function upsertEntry(
  entries: ExtensionEntry[],
  update: ExtensionEntry,
): ExtensionEntry[] {
  const next = entries.filter((entry) => entry.appid !== update.appid)
  next.push(update)
  return next.sort((a, b) => a.appid.localeCompare(b.appid))
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const outputPath = resolve(args.output)

  let entries: ExtensionEntry[] = []
  const mergePath = args.mergeFrom ? resolve(args.mergeFrom) : outputPath
  try {
    entries = parseManifest(readFileSync(mergePath, 'utf8'))
  } catch {
    entries = []
  }

  entries = upsertEntry(entries, {
    appid: args.appId,
    version: args.version,
    codebase: args.codebase,
  })

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, renderManifest(entries))
}

main()
