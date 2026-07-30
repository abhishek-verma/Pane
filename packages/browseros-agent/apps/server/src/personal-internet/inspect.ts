/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Inspect raw page files for validation/repair without losing diagnostics.
 */

import { readFile } from 'node:fs/promises'
import {
  buildPageDiagnosis,
  type PiPageDiagnosis,
  summarizeRawPage,
} from './diagnose'
import { PiDslError, validatePageDoc } from './dsl'
import { BOARD_SHAPE_HINT } from './pi-node-schema'
import type { PiPageDoc } from './types'

export type PiPageInspection = {
  pageId: string
  siteId: string | null
  title: string
  route: string
  ok: boolean
  /** Validated (and board-coerced) doc when readable. */
  doc: PiPageDoc | null
  /** Raw JSON from disk — present when the file parses. Prefer diagnosis over raw. */
  raw: unknown | null
  issues: string[]
  fixHint: string
  diagnosis: PiPageDiagnosis
  /** Compact content summary — enough for agent without full raw. */
  contentSummary: ReturnType<typeof summarizeRawPage> | null
}

export const PI_PAGE_FIX_HINT = [
  'Follow diagnosis.agentBrief — tool-level steps, not raw validator text.',
  'Call pi_read(pageId) for diagnosis (+ contentSummary). Use raw only when diagnosis.needsRaw is true.',
  BOARD_SHAPE_HINT,
].join(' ')

function routeFor(siteId: string | null, pageId: string): string {
  return siteId ? `#/pi/sites/${siteId}/pages/${pageId}` : `#/pi/temp/${pageId}`
}

function emptyDiagnosis(pageId: string, issues: string[]): PiPageDiagnosis {
  return buildPageDiagnosis({
    pageId,
    issues,
    raw: null,
  })
}

/** Inspect a page file by path (no store import — avoids cycles). */
export async function inspectPageFile(input: {
  pageId: string
  siteId: string | null
  title: string
  filePath: string
}): Promise<PiPageInspection> {
  const base: PiPageInspection = {
    pageId: input.pageId,
    siteId: input.siteId,
    title: input.title,
    route: routeFor(input.siteId, input.pageId),
    ok: false,
    doc: null,
    raw: null,
    issues: [],
    fixHint: PI_PAGE_FIX_HINT,
    diagnosis: emptyDiagnosis(input.pageId, []),
    contentSummary: null,
  }

  let rawText: string
  try {
    rawText = await readFile(input.filePath, 'utf-8')
  } catch (e) {
    base.issues.push(
      `Could not read page file: ${e instanceof Error ? e.message : String(e)}`,
    )
    base.diagnosis = buildPageDiagnosis({
      pageId: input.pageId,
      issues: base.issues,
      raw: null,
      fallbackTitle: input.title,
    })
    return base
  }

  let raw: unknown
  try {
    raw = JSON.parse(rawText) as unknown
    base.raw = raw
    base.contentSummary = summarizeRawPage(raw)
  } catch (e) {
    base.issues.push(
      `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    )
    base.diagnosis = buildPageDiagnosis({
      pageId: input.pageId,
      issues: base.issues,
      raw: null,
      fallbackTitle: input.title,
    })
    return base
  }

  try {
    try {
      validatePageDoc(structuredClone(raw), { coerceBoards: false })
    } catch (strictErr) {
      if (strictErr instanceof PiDslError) {
        base.issues.push(`Coerced on read: ${strictErr.message}`)
      }
    }
    const doc = validatePageDoc(raw, { coerceBoards: true })
    base.doc = doc
    base.ok = true
    base.title = doc.title || input.title
    base.diagnosis = buildPageDiagnosis({
      pageId: input.pageId,
      issues: base.issues,
      raw,
      fallbackTitle: input.title,
    })
    // If coerce notes exist but doc is ok, diagnosis marks board_shape as info.
    return base
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    base.issues.push(message)
    base.diagnosis = buildPageDiagnosis({
      pageId: input.pageId,
      issues: base.issues,
      raw,
      fallbackTitle: input.title,
    })
    if (base.diagnosis.autoFixedDoc) {
      base.doc = base.diagnosis.autoFixedDoc
      base.ok = true
      base.title = base.doc.title || input.title
    }
    if (/board|cardIds|columnId/i.test(message)) {
      base.fixHint = BOARD_SHAPE_HINT
    }
    return base
  }
}
