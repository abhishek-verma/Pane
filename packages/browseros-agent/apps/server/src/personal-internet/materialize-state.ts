/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getDbHandle } from '../lib/db'
import { BTF_LOADING_NOTE } from './atf'
import { getPage, readPageDoc } from './store'
import type { PiMaterializePhase, PiPageDoc } from './types'

function sqlite() {
  return getDbHandle().sqlite
}

/** @deprecated Legacy stub heuristic — prefer meta.materialize.phase */
export function isEntityStubDoc(doc: PiPageDoc | null | undefined): boolean {
  if (!doc) return true
  if (doc.meta?.materialize?.phase === 'done') return false
  if (doc.meta?.materialize?.phase === 'atf') return false
  if (
    doc.meta?.materialize?.phase === 'btf-structure' ||
    doc.meta?.materialize?.phase === 'btf-filling'
  ) {
    return false
  }
  return doc.nodes.some(
    (n) => n.type === 'note' && n.text.includes('Preparing details'),
  )
}

export function isLegacyStubDoc(doc: PiPageDoc | null | undefined): boolean {
  if (!doc) return true
  if (doc.meta?.materialize) return false
  return doc.nodes.some(
    (n) => n.type === 'note' && n.text.includes('Preparing details'),
  )
}

export function getMaterializePhase(
  doc: PiPageDoc | null | undefined,
): PiMaterializePhase {
  if (!doc) return 'atf'
  if (doc.meta?.materialize?.phase) return doc.meta.materialize.phase
  if (isLegacyStubDoc(doc)) return 'atf'
  // Filled page without meta (pre-ATF agent rewrite) treat as done
  if (!isEntityStubDoc(doc) && !hasBtfLoadingMarker(doc)) return 'done'
  return 'atf'
}

export function hasBtfLoadingMarker(doc: PiPageDoc): boolean {
  const walk = (nodes: PiPageDoc['nodes']): boolean => {
    for (const n of nodes) {
      if (n.type === 'note' && n.text.includes(BTF_LOADING_NOTE)) return true
      if (n.type === 'note' && n.text.includes('Preparing details')) return true
      if (n.type === 'stack' && walk(n.children)) return true
    }
    return false
  }
  return walk(doc.nodes)
}

export function isAtfReady(doc: PiPageDoc | null | undefined): boolean {
  if (!doc) return false
  if (isLegacyStubDoc(doc)) return false
  return Boolean(doc.meta?.materialize) || !isEntityStubDoc(doc)
}

export function isBtfComplete(doc: PiPageDoc | null | undefined): boolean {
  if (!doc) return false
  if (doc.meta?.materialize?.phase === 'done') return true
  if (doc.meta?.materialize) return false
  return !isLegacyStubDoc(doc) && !hasBtfLoadingMarker(doc)
}

export function setPageStatus(pageId: string, status: string): void {
  const page = getPage(pageId)
  if (!page) return
  sqlite()
    .prepare(`UPDATE pi_pages SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, Date.now(), pageId)
}

export async function finalizeMaterializePageStatus(
  pageId: string,
  runOk: boolean,
): Promise<'active' | 'refreshing' | 'error-stale'> {
  const doc = await readPageDoc(pageId)
  if (!runOk) {
    setPageStatus(pageId, 'error-stale')
    return 'error-stale'
  }
  if (isBtfComplete(doc) || doc?.meta?.materialize?.phase === 'done') {
    setPageStatus(pageId, 'active')
    return 'active'
  }
  if (isLegacyStubDoc(doc)) {
    setPageStatus(pageId, 'refreshing')
    return 'refreshing'
  }
  // ATF or partial BTF still enriching
  if (!isBtfComplete(doc)) {
    setPageStatus(pageId, 'refreshing')
    return 'refreshing'
  }
  setPageStatus(pageId, 'active')
  return 'active'
}
