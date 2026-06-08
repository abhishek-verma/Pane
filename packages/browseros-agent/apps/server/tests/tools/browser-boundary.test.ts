import { describe, it } from 'bun:test'
import assert from 'node:assert'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BROWSER_TOOLS } from '../../src/tools/browser/registry'

const compactBrowserToolFiles = [
  'act.ts',
  'diff.ts',
  'framework.ts',
  'grep.ts',
  'navigate.ts',
  'output-file.ts',
  'read.ts',
  'register.ts',
  'registry.ts',
  'run.ts',
  'screenshot.ts',
  'snapshot.ts',
  'tabs.ts',
  'trust-boundary.ts',
  'wait.ts',
]

const legacyBrowserToolFiles = [
  'bookmarks.ts',
  'dom.ts',
  'history.ts',
  'input.ts',
  'navigation.ts',
  'page-actions.ts',
  'snapshot.ts',
  'tab-groups.ts',
  'windows.ts',
]

const legacyOnlyToolNames = [
  'get_bookmarks',
  'get_dom',
  'search_history',
  'click',
  'list_pages',
  'save_pdf',
  'take_snapshot',
  'group_tabs',
  'list_windows',
]

describe('browser tool boundary', () => {
  it('keeps the compact browser tools under src/tools/browser', () => {
    const toolsDir = join(import.meta.dir, '../../src/tools')

    for (const file of compactBrowserToolFiles) {
      assert.ok(
        existsSync(join(toolsDir, 'browser', file)),
        `Expected browser/${file}`,
      )
    }
  })

  it('keeps the old browser modules as legacy reference code only', () => {
    const toolsDir = join(import.meta.dir, '../../src/tools')

    for (const file of legacyBrowserToolFiles) {
      assert.ok(
        existsSync(join(toolsDir, 'legacy/browser', file)),
        `Expected legacy/browser/${file}`,
      )
      if (file !== 'snapshot.ts') {
        assert.ok(
          !existsSync(join(toolsDir, 'browser', file)),
          `Unexpected active legacy browser module ${file}`,
        )
      }
    }
  })

  it('does not register the legacy-only browser tool names', () => {
    const activeNames = new Set(BROWSER_TOOLS.map((tool) => tool.name))

    for (const name of legacyOnlyToolNames) {
      assert.ok(!activeNames.has(name), `Unexpected active tool ${name}`)
    }
  })
})
