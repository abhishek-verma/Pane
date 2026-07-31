#!/usr/bin/env bun
/**
 * Ship gate: keep the intentional 4 GB agent-extension heap headroom.
 * Also documents that Mermaid sandbox pages are separate (non-privileged).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const patch = join(
  import.meta.dirname,
  '../../browseros/chromium_patches/chrome/browser/extensions/chrome_content_browser_client_extensions_part.cc',
)

if (!existsSync(patch)) {
  console.error(`assert-agent-extension-heap-flag: missing ${patch}`)
  process.exit(1)
}

const body = readFileSync(patch, 'utf8')
if (!body.includes('--max-old-space-size=4096')) {
  console.error(
    'assert-agent-extension-heap-flag: expected --max-old-space-size=4096 in agent extension patch',
  )
  process.exit(1)
}

console.log(
  'assert-agent-extension-heap-flag: OK (4 GB agent-extension heap retained)',
)
