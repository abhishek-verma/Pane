#!/usr/bin/env bun
/**
 * Production-bundle graph assertions for privileged extension entrypoints.
 *
 * Fails if posthog-recorder or mermaid leak into sidepanel/app/pi, or if
 * mermaid is missing from the sandboxed Mermaid page.
 *
 * Usage:
 *   bun scripts/assert-privileged-bundle.ts [--dist apps/app/dist/chrome-mv3]
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const args = process.argv.slice(2)
const distFlag = args.indexOf('--dist')
const distArg = distFlag >= 0 ? args[distFlag + 1] : undefined
const distRoot =
  distArg ?? join(import.meta.dirname, '../apps/app/dist/chrome-mv3')

const PRIVILEGED_HTML = ['sidepanel.html', 'app.html', 'pi.html'] as const
const SANDBOX_HTML_CANDIDATES = [
  'mermaid-sandbox.html',
  'mermaid.html',
] as const

const FORBIDDEN_IN_PRIVILEGED = [
  'posthog-recorder',
  'posthog-js/dist/posthog-recorder',
] as const

function die(msg: string): never {
  console.error(`assert-privileged-bundle: ${msg}`)
  process.exit(1)
}

function listFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) listFiles(full, acc)
    else acc.push(full)
  }
  return acc
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function matchAllGroups(re: RegExp, text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(re)) {
    const group = match[1]
    if (group) out.push(group)
  }
  return out
}

/** Collect script srcs referenced from an HTML entry (relative to dist root). */
function scriptSrcsFromHtml(html: string): string[] {
  const srcs: string[] = []
  const re = /(?:src|href)=["']([^"']+\.(?:js|mjs|css))["']/gi
  for (const src of matchAllGroups(re, html)) {
    if (src.startsWith('http') || src.startsWith('//')) continue
    const cleaned = src.replace(/^\.\//, '').replace(/^\//, '')
    srcs.push(join(distRoot, cleaned))
  }
  return srcs
}

function resolveRef(fromPath: string, ref: string): string | null {
  if (ref.startsWith('http') || ref.startsWith('data:')) return null
  const candidates = [
    join(distRoot, ref.replace(/^\//, '')),
    join(fromPath, '..', ref),
  ]
  for (const c of candidates) {
    const parts: string[] = []
    for (const p of c.replace(/\\/g, '/').split('/')) {
      if (p === '..') parts.pop()
      else if (p !== '.') parts.push(p)
    }
    const resolved = parts.join('/')
    if (existsSync(resolved)) return resolved
  }
  return null
}

/** BFS over JS import/chunk references reachable from seed files. */
function reachableJs(seeds: string[]): { files: Set<string>; bytes: number } {
  const files = new Set<string>()
  const queue = [...seeds]
  let bytes = 0
  const importRe =
    /(?:from\s+|import\s*\(|import\s+|new\s+URL\()\s*["']([^"']+)["']/g
  const chunkRe = /["'](\.?\.?\/?assets\/[^"']+\.js)["']/g

  while (queue.length > 0) {
    const path = queue.pop()
    if (!path || files.has(path) || !existsSync(path)) continue
    if (!/\.(js|mjs|css|html)$/.test(path)) continue
    files.add(path)
    const body = read(path)
    bytes += Buffer.byteLength(body, 'utf8')
    if (!/\.(js|mjs)$/.test(path)) continue

    const refs = [
      ...matchAllGroups(importRe, body),
      ...matchAllGroups(chunkRe, body),
    ]
    for (const ref of refs) {
      const resolved = resolveRef(path, ref)
      if (resolved && !files.has(resolved)) queue.push(resolved)
    }
  }
  return { files, bytes }
}

function contentMentions(files: Set<string>, needle: string): string[] {
  const hits: string[] = []
  for (const f of files) {
    if (!/\.(js|mjs|html)$/.test(f)) continue
    if (read(f).includes(needle)) hits.push(relative(distRoot, f))
  }
  return hits
}

function findSandboxHtml(): string {
  for (const name of SANDBOX_HTML_CANDIDATES) {
    const p = join(distRoot, name)
    if (existsSync(p)) return p
  }
  const found = listFiles(distRoot).filter((f) =>
    /mermaid(-sandbox)?\.html$/i.test(f),
  )
  if (found[0]) return found[0]
  die(
    `no mermaid sandbox HTML under ${distRoot} (expected one of ${SANDBOX_HTML_CANDIDATES.join(', ')})`,
  )
}

function resolvePrivilegedHtml(htmlName: string): string {
  const htmlPath = join(distRoot, htmlName)
  if (existsSync(htmlPath)) return htmlPath
  const alt = listFiles(distRoot).find((f) => f.endsWith(`/${htmlName}`))
  if (!alt) die(`missing privileged entry ${htmlName}`)
  return alt
}

if (!existsSync(distRoot)) {
  die(
    `dist not found at ${distRoot}. Build the agent first (bun run build:agent).`,
  )
}

console.log(`assert-privileged-bundle: scanning ${distRoot}`)

const sizeReport: Record<string, number> = {}

for (const htmlName of PRIVILEGED_HTML) {
  const resolved = resolvePrivilegedHtml(htmlName)
  const html = read(resolved)
  const seeds = [resolved, ...scriptSrcsFromHtml(html)]
  const { files, bytes } = reachableJs(seeds)
  sizeReport[htmlName] = bytes

  for (const needle of FORBIDDEN_IN_PRIVILEGED) {
    const hits = contentMentions(files, needle)
    if (hits.length) {
      die(
        `${htmlName} reaches ${needle} via:\n  ${hits.slice(0, 10).join('\n  ')}`,
      )
    }
  }

  // Real Mermaid runtime must not be reachable from privileged shells.
  // Note: Vite may still name an unrelated shared chunk `mermaid-*` because
  // Streamdown ships a lazy `mermaid-*.js` re-export; filename alone is not
  // proof of the mermaid package (Crashpad historically misattributed that).
  const mermaidRuntime = [
    ...contentMentions(files, 'mermaidAPI'),
    ...contentMentions(files, 'createMermaidPlugin'),
    ...contentMentions(files, 'node_modules/mermaid'),
  ]
  if (mermaidRuntime.length) {
    die(
      `${htmlName} appears to reach the mermaid package:\n  ${mermaidRuntime.slice(0, 10).join('\n  ')}`,
    )
  }

  console.log(
    `  OK ${htmlName}: ${files.size} files, ${(bytes / 1024).toFixed(1)} KiB reachable`,
  )
}

const sandboxHtml = findSandboxHtml()
const sandboxSeeds = [sandboxHtml, ...scriptSrcsFromHtml(read(sandboxHtml))]
const sandbox = reachableJs(sandboxSeeds)
const hasMermaid =
  contentMentions(sandbox.files, 'mermaidAPI').length > 0 ||
  contentMentions(sandbox.files, 'maxEdges').length > 0 ||
  [...sandbox.files].some((f) => /mermaid/i.test(f))

if (!hasMermaid) {
  die(
    `sandbox ${relative(distRoot, sandboxHtml)} does not appear to bundle mermaid`,
  )
}

const sandboxRecorder = contentMentions(sandbox.files, 'posthog-recorder')
if (sandboxRecorder.length) {
  die(`sandbox reaches posthog-recorder via ${sandboxRecorder.join(', ')}`)
}

console.log(
  `  OK sandbox ${relative(distRoot, sandboxHtml)}: ${sandbox.files.size} files, ${(sandbox.bytes / 1024).toFixed(1)} KiB`,
)
console.log('privileged entry sizes (reachable bytes):', sizeReport)
console.log('assert-privileged-bundle: passed')
