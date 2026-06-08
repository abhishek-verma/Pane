import { afterAll, beforeAll, describe, it } from 'bun:test'
import assert from 'node:assert'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { diffSnapshots } from '../../src/browser/core/snapshot/diff'
import {
  type BrowserFixtureServer,
  fixtureRoutes,
  startBrowserFixtureServer,
} from '../__fixtures__/browser-fixtures/app'
import {
  cleanupWithBrowser,
  type WithBrowserContext,
  withBrowser,
} from '../__helpers__/with-browser'
import {
  check,
  click,
  close_page,
  evaluate_script,
  list_pages,
  navigate_page,
  new_page,
  search_dom,
  select_option,
  take_snapshot,
  uncheck,
  upload_file,
} from './browser/helpers'

let fixtureServer: BrowserFixtureServer

function textOf(result: {
  content: { type: string; text?: string }[]
}): string {
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

function structuredOf<T>(result: { structuredContent?: unknown }): T {
  assert.ok(result.structuredContent, 'Expected structuredContent')
  return result.structuredContent as T
}

function pageIdOf(result: {
  content: { type: string; text?: string }[]
  structuredContent?: unknown
}): number {
  const data = result.structuredContent as { pageId?: number } | undefined
  if (typeof data?.pageId === 'number') return data.pageId
  return Number(textOf(result).match(/Page ID:\s*(\d+)/)?.[1])
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findElementId(snapshotText: string, label: string): number {
  const regex = new RegExp(`\\[(\\d+)\\].*?${escapeRegex(label)}`)
  const match = snapshotText.match(regex)
  if (!match) throw new Error(`Element "${label}" not found in snapshot`)
  return Number.parseInt(match[1], 10)
}

async function evalText(
  execute: WithBrowserContext['execute'],
  page: number,
  expression: string,
): Promise<string> {
  const result = await execute(evaluate_script, { page, expression })
  assert.ok(!result.isError, textOf(result))
  return textOf(result)
}

async function openFixturePage(
  execute: WithBrowserContext['execute'],
  path: string,
): Promise<number> {
  const result = await execute(new_page, {
    url: fixtureServer.url(path),
    background: false,
  })
  assert.ok(!result.isError, textOf(result))
  const pageId = pageIdOf(result)
  await waitForExpression(execute, pageId, '!!document.querySelector("main")')
  return pageId
}

async function waitForExpression(
  execute: WithBrowserContext['execute'],
  page: number,
  expression: string,
  timeout = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await execute(evaluate_script, { page, expression })
    if (textOf(result) === 'true') return
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for expression: ${expression}`)
}

async function snapshotText(
  execute: WithBrowserContext['execute'],
  page: number,
): Promise<string> {
  const result = await execute(take_snapshot, { page })
  assert.ok(!result.isError, textOf(result))
  return textOf(result)
}

async function backendNodeIdFor(
  execute: WithBrowserContext['execute'],
  page: number,
  query: string,
): Promise<number> {
  const result = await execute(search_dom, { page, query, limit: 1 })
  assert.ok(!result.isError, textOf(result))
  const data = structuredOf<{
    results: Array<{ backendNodeId: number }>
  }>(result)
  assert.ok(data.results[0], `Expected DOM match for ${query}`)
  return data.results[0].backendNodeId
}

beforeAll(async () => {
  fixtureServer = await startBrowserFixtureServer()
})

afterAll(async () => {
  await cleanupWithBrowser()
  await fixtureServer.stop()
}, 30_000)

describe('browser tool fixture app', () => {
  it('clicks normal and out-of-viewport targets', async () => {
    await withBrowser(async ({ execute }) => {
      const pageId = await openFixturePage(execute, fixtureRoutes.clicks)
      try {
        const snap = await snapshotText(execute, pageId)
        assert.ok(
          snap.includes('Frame click target'),
          'Iframe target should be visible in the fixture snapshot',
        )

        await execute(click, {
          page: pageId,
          element: findElementId(snap, 'Normal click target'),
        })
        assert.strictEqual(
          await evalText(execute, pageId, 'window.fixtureClicks.normal'),
          '1',
        )

        await execute(click, {
          page: pageId,
          element: findElementId(snap, 'Out of viewport click target'),
        })
        assert.strictEqual(
          await evalText(execute, pageId, 'window.fixtureClicks.deep'),
          '1',
        )
      } finally {
        await execute(close_page, { page: pageId })
      }
    })
  }, 60_000)

  it.todo('clicks same-origin iframe targets with frame-local coordinates')

  it.todo('click uses JS fallback for zero-geometry interactive targets')

  it('diffs a snapshot after controls are added and removed', async () => {
    await withBrowser(async ({ execute }) => {
      const pageId = await openFixturePage(execute, fixtureRoutes.snapshotDiff)
      try {
        const before = await snapshotText(execute, pageId)
        await execute(click, {
          page: pageId,
          element: findElementId(before, 'Reveal ten new actions'),
        })
        await waitForExpression(
          execute,
          pageId,
          'document.body.innerText.includes("after mutation: added 10 removed 5")',
        )

        const after = await snapshotText(execute, pageId)
        const diff = diffSnapshots(before, after)

        assert.strictEqual(diff.changed, true)
        assert.ok(diff.added >= 10, diff.text)
        assert.ok(diff.removed >= 5, diff.text)
        assert.ok(diff.text.includes('New action 10'), diff.text)
        assert.ok(diff.text.includes('Old action 1'), diff.text)
      } finally {
        await execute(close_page, { page: pageId })
      }
    })
  }, 60_000)

  it('checks, unchecks, and selects form controls', async () => {
    await withBrowser(async ({ execute }) => {
      const pageId = await openFixturePage(execute, fixtureRoutes.formControls)
      try {
        const snap = await snapshotText(execute, pageId)
        const checkboxId = findElementId(snap, 'Receive updates')

        await execute(check, { page: pageId, element: checkboxId })
        assert.strictEqual(
          await evalText(execute, pageId, 'window.fixtureForm.checked'),
          'true',
        )

        await execute(uncheck, { page: pageId, element: checkboxId })
        assert.strictEqual(
          await evalText(execute, pageId, 'window.fixtureForm.checked'),
          'false',
        )

        const selectId = findElementId(snap, 'Plan select')
        await execute(select_option, {
          page: pageId,
          element: selectId,
          value: 'enterprise',
        })
        assert.strictEqual(
          await evalText(execute, pageId, 'window.fixtureForm.selected'),
          'enterprise',
        )
      } finally {
        await execute(close_page, { page: pageId })
      }
    })
  }, 60_000)

  it('uploads a file on a normal page and a popup page', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'browseros-fixture-upload-'))
    const uploadPath = join(tempDir, 'fixture-upload.txt')
    writeFileSync(uploadPath, 'fixture upload body')

    await withBrowser(async ({ execute }) => {
      const pageId = await openFixturePage(execute, fixtureRoutes.upload)
      let popupPageId: number | undefined
      let launcherPageId: number | undefined
      try {
        const uploadId = await backendNodeIdFor(
          execute,
          pageId,
          '#fixture-upload',
        )
        await execute(upload_file, {
          page: pageId,
          element: uploadId,
          files: [uploadPath],
        })
        assert.strictEqual(
          await evalText(execute, pageId, 'window.fixtureUpload.names[0]'),
          basename(uploadPath),
        )

        launcherPageId = await openFixturePage(
          execute,
          fixtureRoutes.uploadPopupLauncher,
        )
        const launcherSnap = await snapshotText(execute, launcherPageId)
        await execute(click, {
          page: launcherPageId,
          element: findElementId(launcherSnap, 'Open upload popup'),
        })
        await waitForExpression(
          execute,
          launcherPageId,
          'document.body.innerText.includes("popup:opened")',
        )

        for (let attempt = 0; attempt < 20; attempt++) {
          const pagesResult = await execute(list_pages, {})
          const pages = structuredOf<{
            pages: Array<{ pageId: number; title: string; url: string }>
          }>(pagesResult).pages
          popupPageId = pages.find(
            (page) =>
              page.title === 'Upload popup fixture' ||
              page.url.endsWith(fixtureRoutes.uploadPopupWindow),
          )?.pageId
          if (popupPageId !== undefined) break
          await Bun.sleep(100)
        }
        assert.ok(popupPageId, 'Expected popup upload page to appear')

        const popupUploadId = await backendNodeIdFor(
          execute,
          popupPageId,
          '#fixture-upload',
        )
        await execute(upload_file, {
          page: popupPageId,
          element: popupUploadId,
          files: [uploadPath],
        })
        assert.strictEqual(
          await evalText(execute, popupPageId, 'window.fixtureUpload.names[0]'),
          basename(uploadPath),
        )
      } finally {
        if (popupPageId !== undefined) {
          await execute(close_page, { page: popupPageId })
        }
        if (launcherPageId !== undefined) {
          await execute(close_page, { page: launcherPageId })
        }
        await execute(close_page, { page: pageId })
      }
    })

    rmSync(tempDir, { recursive: true, force: true })
  }, 60_000)

  it('performs simple SPA navigation with history state', async () => {
    await withBrowser(async ({ execute }) => {
      const pageId = await openFixturePage(execute, fixtureRoutes.spa)
      try {
        const snap = await snapshotText(execute, pageId)
        await execute(click, {
          page: pageId,
          element: findElementId(snap, 'SPA Settings'),
        })

        assert.strictEqual(
          await evalText(execute, pageId, 'window.fixtureSpaView'),
          'settings',
        )
        assert.strictEqual(
          await evalText(execute, pageId, 'location.pathname'),
          '/spa/settings',
        )

        await execute(navigate_page, { page: pageId, action: 'back' })
        assert.strictEqual(
          await evalText(execute, pageId, 'window.fixtureSpaView'),
          'home',
        )
      } finally {
        await execute(close_page, { page: pageId })
      }
    })
  }, 60_000)
})
